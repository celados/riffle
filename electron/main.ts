import {
  app,
  autoUpdater as nativeAutoUpdater,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  MessageChannelMain,
  protocol,
  screen,
  shell,
  utilityProcess,
  type UtilityProcess,
  type WebContents,
} from "electron";
import { realpath, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as v from "valibot";
import electronUpdater from "electron-updater";
import {
  controlRequestSchema,
  controlResponseSchema,
  engineChannelFailureSchema,
  engineControlSchema,
  engineStateSchema,
  nativeRequestSchema,
  nativeResponseSchema,
  type ControlResponse,
  type DesktopErrorData,
  type EngineState,
  windowKindSchema,
  type NativeRequest,
} from "./bridge-contract";
import { createEngineGenerationTerminal } from "./engine-generation";
import { isTrustedCloudUrl, resolveCloudConfig } from "./cloud-config";
import { loadAssetResponse, NativeContentError, writeExportFile } from "./native-content";
import { UpdaterService, UpdaterServiceError } from "./updater-service";
import { resolveE2eUpdateChannel } from "./update-channel";
import {
  consumeReleaseE2eState,
  prepareReleaseE2eState,
  readReleaseE2eState,
} from "./release-e2e-state";
import { createQuitCoordinator } from "./quit-coordinator";
import { importLegacyConfig } from "./product-identity";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const development =
  Boolean(process.env.VITE_DEV_SERVER_URL) ||
  process.env.RIFFLE_ENABLE_DEVTOOLS === "1";
const explicitBackgroundE2e = process.env.RIFFLE_E2E_BACKGROUND === "1";
const releaseE2eState =
  prepareReleaseE2eState(process.env, process.execPath) ??
  readReleaseE2eState(process.execPath);
const backgroundE2e = explicitBackgroundE2e || releaseE2eState !== null;
if (releaseE2eState) app.setPath("userData", releaseE2eState.configDir);
const { autoUpdater } = electronUpdater;
const e2eUpdateChannel = resolveE2eUpdateChannel(
  process.env.RIFFLE_E2E_UPDATE_URL,
  backgroundE2e,
);
if (e2eUpdateChannel) {
  // A loopback-only override lets signed packages exercise the real updater before publication.
  autoUpdater.setFeedURL({ provider: "generic", url: e2eUpdateChannel });
}
const updater = new UpdaterService(autoUpdater, app.getVersion(), app.isPackaged);

autoUpdater.logger = {
  info: (message) => console.log(`[riffle-updater] ${String(message)}`),
  warn: (message) => console.warn(`[riffle-updater] ${String(message)}`),
  error: (message) => console.error(`[riffle-updater] ${String(message)}`),
  debug: (message) => console.debug(`[riffle-updater] ${String(message)}`),
};

if (backgroundE2e && process.platform === "darwin") {
  // Smoke tests need the real app process without activating a Dock app in the
  // user's session. Foreground behavior remains the production default.
  app.setActivationPolicy("prohibited");
}
let engine: UtilityProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let captureWindow: BrowserWindow | null = null;
let engineEpoch = 0;
let restartAvailable = true;
let engineState: EngineState | null = null;
let engineSpawned = false;
const attachedWebContents = new Set<number>();
const loadedWebContents = new Set<number>();
const windowKinds = new Map<number, v.InferOutput<typeof windowKindSchema>>();
const captureAccelerator =
  process.env.RIFFLE_TEST_QUICK_CAPTURE_ACCELERATOR ?? "Control+Shift+Space";
const quitCoordinator = createQuitCoordinator(() => {
  globalShortcut.unregisterAll();
  engine?.kill();
  engine = null;
});
nativeAutoUpdater.on("before-quit-for-update", quitCoordinator.begin);

if (process.platform === "linux") {
  // Wayland exposes global accelerators through the desktop portal rather than
  // X11 grabs. Electron requires this feature switch before app readiness.
  app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
}
let activeAssetRoot: string | null = null;
const stagedAssetRoots = new Map<string, string>();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "riffle-asset",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function attachWindowDiagnostics(webContents: WebContents): void {
  webContents.on("render-process-gone", (_event, details) => {
    console.error("[riffle-renderer] process gone", details);
  });
  webContents.on("unresponsive", () => {
    console.error("[riffle-renderer] unresponsive");
  });
  if (development) {
    webContents.on("console-message", (details) => {
      const write =
        details.level === "error" || details.level === "warning"
          ? console.error
          : console.log;
      write(`[riffle-renderer] ${details.message}`);
    });
    webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const accelerator =
        input.key === "F12" ||
        (process.platform === "darwin"
          ? input.meta && input.alt && input.key.toLowerCase() === "i"
          : input.control && input.shift && input.key.toLowerCase() === "i");
      if (!accelerator) return;
      event.preventDefault();
      webContents.toggleDevTools();
    });
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    show: !backgroundE2e,
    focusable: !backgroundE2e,
    skipTaskbar: backgroundE2e,
    width: 1280,
    height: 820,
    minWidth: 840,
    minHeight: 560,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(moduleDir, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ["--riffle-window-kind=main"],
    },
  });

  attachWindowDiagnostics(window.webContents);
  wireRendererWindow(window, "main");
  return window;
}

function createCaptureWindow(): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    focusable: !backgroundE2e,
    skipTaskbar: true,
    width: 500,
    height: 356,
    minWidth: 500,
    minHeight: 356,
    maxWidth: 500,
    maxHeight: 356,
    resizable: false,
    maximizable: false,
    minimizable: false,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(moduleDir, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  attachWindowDiagnostics(window.webContents);
  wireRendererWindow(window, "quick-capture");
  window.on("close", (event) => {
    if (quitCoordinator.isQuitting()) return;
    event.preventDefault();
    window.hide();
  });
  return window;
}

function wireRendererWindow(
  window: BrowserWindow,
  kind: v.InferOutput<typeof windowKindSchema>,
): void {
  windowKinds.set(window.webContents.id, kind);
  window.webContents.on("did-start-loading", () => {
    attachedWebContents.delete(window.webContents.id);
    loadedWebContents.delete(window.webContents.id);
  });
  window.webContents.on("did-finish-load", () => {
    loadedWebContents.add(window.webContents.id);
    attachRendererToEngine(window);
  });
  window.webContents.on("destroyed", () => {
    attachedWebContents.delete(window.webContents.id);
    loadedWebContents.delete(window.webContents.id);
    windowKinds.delete(window.webContents.id);
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(join(moduleDir, "../dist/index.html"));
  }
}

function riffleWindows(): BrowserWindow[] {
  return [mainWindow, captureWindow].filter(
    (window): window is BrowserWindow => Boolean(window && !window.isDestroyed()),
  );
}

function publishEngineState(state: EngineState): void {
  engineState = v.parse(engineStateSchema, state);
  for (const window of riffleWindows()) {
    window.webContents.send("riffle:engine-state", engineState);
  }
}

function unavailableError(message: string): DesktopErrorData {
  return { kind: "ENGINE_UNAVAILABLE", message };
}

function connectEngine(): UtilityProcess {
  const epoch = ++engineEpoch;
  engineSpawned = false;
  attachedWebContents.clear();
  // A replacement utility must explicitly re-authorize its Vault before the
  // protocol can expose files from the previous generation.
  activeAssetRoot = null;
  stagedAssetRoots.clear();
  publishEngineState({ state: "starting", epoch });
  const child = utilityProcess.fork(join(moduleDir, "engine.js"), [], {
    serviceName: "Riffle Engine",
    stdio: "pipe",
    env: {
      ...process.env,
      RIFFLE_ENGINE_TEST_ABORT_DELAY_MS:
        process.env.RIFFLE_TEST_ABORT_ENGINE_EPOCH === String(epoch)
          ? process.env.RIFFLE_TEST_ABORT_DELAY_MS ?? "500"
          : "",
    },
  });
  const terminal = createEngineGenerationTerminal((message) => {
    publishEngineState({
      state: "unavailable",
      epoch,
      error: unavailableError(message),
    });
    if (engine === child) engine = null;
    if (quitCoordinator.isQuitting() || !restartAvailable || riffleWindows().length === 0) return;
    restartAvailable = false;
    console.log(`[riffle-main] restarting engine after epoch=${epoch}`);
    engine = connectEngine();
  });
  child.once("spawn", () => {
    engineSpawned = true;
    console.log(`[riffle-main] engine spawned epoch=${epoch} pid=${child.pid}`);
    for (const window of riffleWindows()) attachRendererToEngine(window);
  });
  child.on("exit", (code) => {
    console.error(`[riffle-main] engine exited epoch=${epoch} code=${code}`);
    terminal.terminate("Riffle Engine exited unexpectedly.");
  });
  child.on("error", (type, location, report) => {
    console.error("[riffle-main] engine fatal error", {
      epoch,
      type,
      location,
      report,
    });
    terminal.terminate("Riffle Engine encountered a fatal error.");
    child.kill();
  });
  child.on("message", (input: unknown) => {
    const request = v.safeParse(nativeRequestSchema, input);
    if (!request.success || request.output.epoch !== epoch) return;
    void performNativeRequest(request.output)
      .then((value) => child.postMessage(v.parse(nativeResponseSchema, {
        type: "native-response",
        id: request.output.id,
        epoch,
        ok: true,
        value,
      })))
      .catch((error: unknown) => child.postMessage(v.parse(nativeResponseSchema, {
        type: "native-response",
        id: request.output.id,
        epoch,
        ok: false,
        error: {
          kind:
            error instanceof NativeContentError
              ? error.kind
              : "NATIVE_OPERATION_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      })));
  });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  return child;
}

function attachRendererToEngine(window: BrowserWindow): void {
  const child = engine;
  const webContents = window.webContents;
  if (
    !child ||
    !engineSpawned ||
    !loadedWebContents.has(webContents.id) ||
    attachedWebContents.has(webContents.id) ||
    window.isDestroyed()
  ) {
    return;
  }
  attachedWebContents.add(webContents.id);
  const windowKind = windowKinds.get(webContents.id);
  if (!windowKind) {
    throw new Error("Riffle Desktop cannot attach an unowned renderer window.");
  }
  const { port1, port2 } = new MessageChannelMain();
  const transfer = () => {
    if (engine !== child || window.isDestroyed()) {
      port1.close();
      port2.close();
      return;
    }
    child.postMessage({
      type: "connect",
      epoch: engineEpoch,
      configDir:
        releaseE2eState?.configDir ??
        process.env.RIFFLE_TEST_CONFIG_DIR ??
        app.getPath("userData"),
      windowKind,
    }, [port1]);
    webContents.postMessage(
      "riffle:engine-port",
      { epoch: engineEpoch, windowKind },
      [port2],
    );
  };
  const delay = Number(process.env.RIFFLE_TEST_ENGINE_TRANSFER_DELAY_MS ?? 0);
  if (Number.isFinite(delay) && delay > 0) setTimeout(transfer, delay);
  else transfer();
}

async function performNativeRequest(
  request: NativeRequest,
): Promise<unknown> {
  if (request.method === "asset-root.stage") {
    const stageId = randomUUID();
    stagedAssetRoots.set(
      stageId,
      await validateAssetRoot(request.root, request.assetRoot),
    );
    return stageId;
  }
  if (request.method === "asset-root.commit") {
    const stagedRoot = stagedAssetRoots.get(request.stageId);
    if (!stagedRoot) {
      throw new NativeContentError("INVALID_INPUT", "Asset-root stage does not exist.");
    }
    // Assignment is the native commit point: there is no awaited work after
    // the protocol root changes, so a reported failure cannot be half-applied.
    activeAssetRoot = stagedRoot;
    stagedAssetRoots.delete(request.stageId);
    return null;
  }
  if (request.method === "asset-root.rollback") {
    stagedAssetRoots.delete(request.stageId);
    return null;
  }
  if (request.method === "export.save") {
    const owner = mainWindow;
    if (request.windowKind !== "main" || !owner || owner.isDestroyed()) {
      throw new NativeContentError(
        "INVALID_INPUT",
        "Export is only available from the live main window.",
      );
    }
    if (process.env.RIFFLE_TEST_EXPORT_FAILURE === "1") {
      throw new Error("The operating system rejected the export operation.");
    }
    const result = await dialog.showSaveDialog(owner, {
      title: "Export Markdown",
      defaultPath: request.suggestedName,
      buttonLabel: "Export",
    });
    if (result.canceled || !result.filePath) return null;
    return writeExportFile(result.filePath, request.content);
  }
  if (process.env.RIFFLE_TEST_TRASH_FAILURE === "1") {
    throw new Error("The operating system rejected the Trash operation.");
  }
  const root = await realpath(request.root);
  const path = resolve(request.path);
  const offset = relative(root, path);
  if (
    offset === "" ||
    offset === ".." ||
    offset.startsWith(`..${sep}`) ||
    isAbsolute(offset)
  ) {
    throw new Error("Riffle Desktop rejected a Trash target outside the Vault.");
  }
  // The lexical path is the authorization boundary: a Vault directory link
  // deliberately grants access to its target while keeping the link itself trashable.
  await realpath(path);
  await shell.trashItem(path);
  return null;
}

async function validateAssetRoot(root: string, assetRoot: string): Promise<string> {
  const [canonicalRoot, canonicalAssetRoot] = await Promise.all([
    realpath(root),
    realpath(assetRoot),
  ]);
  if (
    normalize(root) !== normalize(canonicalRoot) ||
    normalize(assetRoot) !== normalize(canonicalAssetRoot) ||
    normalize(canonicalAssetRoot) !== normalize(join(canonicalRoot, ".markd", "assets"))
  ) {
    throw new NativeContentError(
      "INVALID_PATH",
      "Riffle Desktop rejected an invalid Vault asset root.",
    );
  }
  const offset = relative(canonicalRoot, canonicalAssetRoot);
  if (!offset || offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw new NativeContentError(
      "INVALID_PATH",
      "Riffle Desktop rejected an asset root outside the Vault.",
    );
  }
  return canonicalAssetRoot;
}

async function handleAssetRequest(request: Request): Promise<Response> {
  if (!activeAssetRoot) return new Response("Asset Vault unavailable", { status: 404 });
  try {
    return await loadAssetResponse(activeAssetRoot, request.url);
  } catch (error) {
    const status =
      error instanceof NativeContentError && error.kind === "NOT_FOUND" ? 404 : 400;
    return new Response("Asset request rejected", {
      status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

function acceptEngineControl(
  event: Electron.IpcMainEvent,
  input: unknown,
): number | null {
  const control = v.safeParse(engineControlSchema, input);
  if (
    !control.success ||
    !windowKinds.has(event.sender.id) ||
    control.output.epoch !== engineEpoch
  ) {
    return null;
  }
  return control.output.epoch;
}

function senderKind(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return windowKinds.get(event.sender.id) ?? null;
}

function showQuickCapture(): void {
  const window = captureWindow;
  if (!window || window.isDestroyed()) {
    captureWindow = createCaptureWindow();
    captureWindow.webContents.once("did-finish-load", showQuickCapture);
    return;
  }
  if (!loadedWebContents.has(window.webContents.id)) {
    window.webContents.once("did-finish-load", showQuickCapture);
    return;
  }
  window.webContents.send("riffle:capture-open");
  if (backgroundE2e) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = window.getBounds();
  window.setPosition(
    Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2),
    Math.round(display.workArea.y + (display.workArea.height - bounds.height) * 0.4),
  );
  window.show();
  window.focus();
}

function closeQuickCapture(): void {
  const window = captureWindow;
  if (!window || window.isDestroyed()) return;
  window.hide();
}

ipcMain.handle("riffle:control", async (event, input: unknown): Promise<ControlResponse> => {
  const request = v.safeParse(controlRequestSchema, input);
  const kind = senderKind(event);
  if (!request.success || !kind) {
    return v.parse(controlResponseSchema, {
      type: "response",
      id: "invalid-request",
      ok: false,
      error: {
        kind: "INVALID_REQUEST",
        message: "Riffle Desktop rejected an invalid request.",
      },
    });
  }

  const { id, method } = request.output;
  if (method === "dialog.chooseVault") {
    if (kind !== "main" || !mainWindow) {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: { kind: "INVALID_REQUEST", message: "Only the main window can choose a Vault." },
      });
    }
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose Vault",
      properties: ["openDirectory", "createDirectory"],
    });
    return v.parse(controlResponseSchema, {
      type: "response",
      id,
      ok: true,
      value: result.canceled ? null : result.filePaths[0] ?? null,
    });
  }
  if (method === "dialog.createVault") {
    if (kind !== "main" || !mainWindow) {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: { kind: "INVALID_REQUEST", message: "Only the main window can create a Vault." },
      });
    }
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Create Vault",
      defaultPath: "Riffle Vault",
      buttonLabel: "Create Vault",
    });
    return v.parse(controlResponseSchema, {
      type: "response",
      id,
      ok: true,
      value: result.canceled ? null : result.filePath ?? null,
    });
  }
  if (method === "updates.install") {
    if (kind !== "main") {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: { kind: "INVALID_REQUEST", message: "Only the main window can install updates." },
      });
    }
    try {
      await updater.download(request.output.params.id);
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: true,
        value: null,
      });
    } catch (error) {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: updaterError(error),
      });
    }
  }
  if (method === "updates.check") {
    if (kind !== "main") {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: { kind: "INVALID_REQUEST", message: "Only the main window can check for updates." },
      });
    }
    try {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: true,
        value: await updater.check(),
      });
    } catch (error) {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: updaterError(error),
      });
    }
  }
  if (method === "app.relaunch") {
    if (kind !== "main") {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: { kind: "INVALID_REQUEST", message: "Only the main window can relaunch Riffle." },
      });
    }
    setImmediate(() => {
      updater.installOrRelaunch(() => {
        app.relaunch();
        app.exit(0);
      });
    });
    return v.parse(controlResponseSchema, {
      type: "response",
      id,
      ok: true,
      value: null,
    });
  }
  if (method === "capture.open") showQuickCapture();
  if (method === "capture.close") closeQuickCapture();
  if (method === "external.openCloud") {
    if (kind !== "main") {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: { kind: "INVALID_WINDOW", message: "Only the main window can open Cloud URLs." },
      });
    }
    const config = resolveCloudConfig(process.env);
    if (!config.ok) {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: { kind: "CLOUD_OWNERSHIP_UNVERIFIED", message: config.message },
      });
    }
    if (!isTrustedCloudUrl(request.output.params.url, config.value)) {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: {
          kind: "UNTRUSTED_EXTERNAL_URL",
          message: "Riffle Desktop rejected an untrusted external URL.",
        },
      });
    }
    await shell.openExternal(request.output.params.url);
  }
  if (method === "external.openWeb") {
    const url = new URL(request.output.params.url);
    if (kind !== "main" || !["http:", "https:"].includes(url.protocol)) {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: {
          kind: kind === "main" ? "UNTRUSTED_EXTERNAL_URL" : "INVALID_WINDOW",
          message: "Riffle Desktop rejected this external URL.",
        },
      });
    }
    await shell.openExternal(url.toString());
  }
  if (method === "external.revealVaultEntry") {
    if (kind !== "main") {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: { kind: "INVALID_WINDOW", message: "Only the main window can reveal Vault entries." },
      });
    }
    try {
      await shell.showItemInFolder(await revealPath(request.output.params.rel));
    } catch (error) {
      return v.parse(controlResponseSchema, {
        type: "response",
        id,
        ok: false,
        error: {
          kind: "INVALID_PATH",
          message: error instanceof Error ? error.message : "The Vault entry could not be revealed.",
        },
      });
    }
  }
  return v.parse(controlResponseSchema, {
    type: "response",
    id,
    ok: true,
    value: null,
  });
});

async function revealPath(rel: string): Promise<string> {
  if (!activeAssetRoot) throw new Error("No Vault is open.");
  const root = dirname(dirname(activeAssetRoot));
  const segments = rel === "" ? [] : rel.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid Vault path.");
  }
  const candidate = resolve(root, ...segments);
  const canonical = await realpath(candidate);
  const offset = relative(root, canonical);
  if (
    normalize(candidate) !== normalize(canonical) ||
    offset === ".." ||
    offset.startsWith(`..${sep}`) ||
    isAbsolute(offset)
  ) {
    throw new Error("Invalid Vault path.");
  }
  return canonical;
}

function updaterError(error: unknown): DesktopErrorData {
  if (error instanceof UpdaterServiceError) {
    return { kind: error.kind, message: error.message };
  }
  return {
    kind: "UPDATE_FAILED",
    message: error instanceof Error ? error.message : "The update operation failed.",
  };
}

ipcMain.handle("riffle:engine-state", (event): EngineState => {
  if (!windowKinds.has(event.sender.id) || !engineState) {
    throw new Error("Riffle Desktop rejected an invalid engine state request.");
  }
  return v.parse(engineStateSchema, engineState);
});

ipcMain.on("riffle:engine-ready", (event, input: unknown) => {
  const epoch = acceptEngineControl(event, input);
  if (epoch === null) return;
  restartAvailable = true;
  publishEngineState({ state: "ready", epoch });
  console.log(`[riffle-main] engine ready epoch=${epoch}`);
});

ipcMain.on("riffle:engine-protocol-error", (event, input: unknown) => {
  const epoch = acceptEngineControl(event, input);
  if (epoch === null) return;
  console.error(`[riffle-main] engine protocol failure epoch=${epoch}`);
  engine?.kill();
});

ipcMain.on("riffle:engine-channel-error", (event, input: unknown) => {
  const failure = v.safeParse(engineChannelFailureSchema, input);
  if (!failure.success || !windowKinds.has(event.sender.id)) return;
  console.error(`[riffle-main] invalid engine channel epoch=${engineEpoch}`);
  engine?.kill();
});

ipcMain.on("riffle:window-kind", (event) => {
  event.returnValue = v.parse(windowKindSchema, windowKinds.get(event.sender.id));
});

app.whenReady().then(async () => {
  if (!releaseE2eState && !process.env.RIFFLE_TEST_CONFIG_DIR) {
    await importLegacyConfig(
      app.getPath("userData"),
      join(app.getPath("appData"), "Markd"),
    );
  }
  console.log("[riffle-main] app ready");
  if (releaseE2eState) {
    // ShipIt does not promise to preserve env; parent-scoped state keeps the replacement hidden and observable.
    void writeFile(releaseE2eState.markerPath, JSON.stringify({
      version: app.getVersion(),
      pid: process.pid,
      executable: app.getPath("exe"),
      nonce: releaseE2eState.nonce,
    })).then(() => {
      if (app.getVersion() === releaseE2eState.expectedVersion) {
        consumeReleaseE2eState(process.execPath, releaseE2eState.nonce);
      }
    }).catch((error: unknown) => {
      console.error("[riffle-main] could not write release evidence", error);
    });
  }
  protocol.handle("riffle-asset", handleAssetRequest);
  mainWindow = createMainWindow();
  mainWindow.webContents.once("did-finish-load", () => {
    if (!captureWindow || captureWindow.isDestroyed()) {
      captureWindow = createCaptureWindow();
    }
  });
  engine = connectEngine();
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (process.platform !== "darwin") app.quit();
  });

  const registered = globalShortcut.register(captureAccelerator, showQuickCapture);
  if (!registered) {
    console.error(`[riffle-main] Quick Capture shortcut unavailable: ${captureAccelerator}`);
  }

  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      return;
    }
    mainWindow = createMainWindow();
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  });
}).catch((error: unknown) => {
  console.error("[riffle-main] startup failed", error);
  app.quit();
});

app.on("before-quit", () => {
  quitCoordinator.begin();
});
