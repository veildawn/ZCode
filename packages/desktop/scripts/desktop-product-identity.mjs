/**
 * 构建期开关：为真时安装包使用 Preview 身份，而后端环境仍由 `ZCODE_ENV` 单独决定。
 * 典型用法是 `ZCODE_ENV=production ZCODE_PREVIEW_IDENTITY=1`，得到一个连接生产后端、
 * 可与正式版并排安装的 `ZCode Preview`。
 */
export const ZCODE_PREVIEW_IDENTITY_ENV = "ZCODE_PREVIEW_IDENTITY";

const PRODUCTION_IDENTITY = Object.freeze({
  flavor: "production",
  appId: "dev.zcode.app",
  productName: "ZCode",
  linuxExecutableName: "zcode",
  linuxPackageName: "zcode",
  cuaHelperInstallVariant: null,
});

const PREVIEW_IDENTITY = Object.freeze({
  flavor: "preview",
  appId: "dev.zcode.app.preview",
  productName: "ZCode Preview",
  linuxExecutableName: "zcode-preview",
  linuxPackageName: "zcode-preview",
  cuaHelperInstallVariant: "preview",
});

/**
 * 下游发行版品牌：叠加在 flavor 之上，替换产品名与包名（本仓库流水线发布的就是它）。
 *
 * 与 flavor 分轴的原因：flavor 决定更新器、签名门与菜单语义，品牌只决定"用户看到的是哪个
 * App"。两者分开后，下游发行版既可以是 preview flavor（官方更新器关闭、与官方 ZCode 并排安装），
 * 也可以在未来切到 production flavor，而名字始终是 `ZCode Gateway`。
 *
 * 换名字只改这一处；`desktopRuntimeEnv.ts` 会用同一份 `productName` 作为运行期应用名与
 * Electron 数据目录名，`electron-builder.config.js` 用同一份生成安装包与产物文件名。
 */
const DOWNSTREAM_BRAND = Object.freeze({
  appId: "dev.veildawn.zcode-gateway",
  productName: "ZCode Gateway",
  linuxExecutableName: "zcode-gateway",
  linuxPackageName: "zcode-gateway",
  // 打包元数据（Linux 包、About、发行说明）里的归属：下游发行版由本仓库维护，
  // 与上游产品的 homepage / 作者区分开。
  homepage: "https://github.com/veildawn/ZCode",
  authorName: "Veildawn",
  authorEmail: "dev@veildawn.cn",
});

const PRODUCT_BRAND_ENV = "ZCODE_PRODUCT_BRAND";

export const desktopProductIdentities = Object.freeze({
  production: PRODUCTION_IDENTITY,
  preview: PREVIEW_IDENTITY,
});

function normalizeDesktopZCodeEnv(env) {
  return env.ZCODE_ENV?.trim().toLowerCase() === "production" ? "production" : "test";
}

/**
 * 开关只有一种开启拼写 `1`（`0` / 空 = 关闭），与 CI workflow 规则和 release 门的
 * `$ZCODE_PREVIEW_IDENTITY == "1"` 精确比较保持同一套语义。其它拼写在构建期直接失败，
 * 避免 `true` 之类在 YAML 路由层漏匹配、却在脚本层被当成开启，把 Preview 包打进生产验收目录。
 */
export function isPreviewIdentityRequested(env = process.env) {
  const value = env[ZCODE_PREVIEW_IDENTITY_ENV]?.trim() ?? "";
  if (value === "1") {
    return true;
  }
  if (value === "" || value === "0") {
    return false;
  }
  throw new Error(
    `invalid ${ZCODE_PREVIEW_IDENTITY_ENV}=${env[ZCODE_PREVIEW_IDENTITY_ENV]}; expected 1 or 0`,
  );
}

/**
 * 产品身份（flavor）与后端环境（`ZCODE_ENV`）是两个轴：
 * - `ZCODE_ENV=test` 一律是 Preview，测试后端不能顶着正式 `ZCode` 身份覆盖用户的正式安装；
 * - `ZCODE_ENV=production` 默认是正式身份，显式 `ZCODE_PREVIEW_IDENTITY=1` 时改用 Preview 身份。
 * 未知 `ZCODE_ENV` 继续按 test 处理，和共享层 normalizeZCodeEnv 的 fail-safe 默认值一致。
 */
export function resolveDesktopProductFlavor(env = process.env) {
  if (isPreviewIdentityRequested(env)) {
    return "preview";
  }
  return normalizeDesktopZCodeEnv(env) === "production" ? "production" : "preview";
}

/**
 * 下游品牌的开关，语义与 `ZCODE_PREVIEW_IDENTITY` 一致：只有 `1` 是开启，
 * `0` / 空是关闭，其它拼写直接失败（避免把品牌漏进上游身份包，或反过来）。
 */
export function isProductBrandRequested(env = process.env) {
  const value = env[PRODUCT_BRAND_ENV]?.trim() ?? "";
  if (value === "1") {
    return true;
  }
  if (value === "" || value === "0") {
    return false;
  }
  throw new Error(`invalid ${PRODUCT_BRAND_ENV}=${env[PRODUCT_BRAND_ENV]}; expected 1 or 0`);
}

/**
 * 由「flavor + 是否下游品牌」两个构建期事实解析身份。
 * 打包产物里 flavor / brand 都来自编译期 define，因此运行期的应用名与数据目录
 * 必然和安装包一致，不依赖启动环境变量。
 */
export function resolveDesktopProductIdentityFromBuild({ flavor, brand = false }) {
  const base = desktopProductIdentities[flavor === "preview" ? "preview" : "production"];
  return brand ? Object.freeze({ ...base, ...DOWNSTREAM_BRAND }) : base;
}

export function resolveDesktopProductIdentity(env = process.env) {
  return resolveDesktopProductIdentityFromBuild({
    flavor: resolveDesktopProductFlavor(env),
    brand: isProductBrandRequested(env),
  });
}

/**
 * 产物文件名后缀标记的是后端环境而不是身份：`_TEST` 只出现在测试后端的安装包上。
 * 生产后端的 Preview 包靠 productName（`ZCode Preview-<version>-...`）与正式包区分。
 */
export function resolveDesktopArtifactSuffix(env = process.env) {
  return normalizeDesktopZCodeEnv(env) === "test" ? "_TEST" : "";
}

/**
 * 返回 Windows Shell 使用的 AppUserModelId。
 *
 * 打包态必须复用 electron-builder 的 appId，否则快捷方式里的 AUMID、开始菜单索引
 * 和运行中的 Electron 进程会被 Windows 视为三个不同的应用。开发态继续保留旧身份，
 * 避免本地调试快捷方式和正式/Preview 安装包互相污染。
 */
export function resolveWindowsAppUserModelIdForFlavor(
  flavor,
  runtime = { isPackaged: true },
  brand = false,
) {
  if (runtime.isPackaged === false) {
    return "cn.aminer.zcode";
  }
  return resolveDesktopProductIdentityFromBuild({ flavor, brand }).appId;
}

export function resolveWindowsAppUserModelId(env = process.env, runtime = { isPackaged: true }) {
  return resolveWindowsAppUserModelIdForFlavor(
    resolveDesktopProductFlavor(env),
    runtime,
    isProductBrandRequested(env),
  );
}
