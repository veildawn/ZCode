/**
 * `desktop-product-identity.mjs` 的类型声明。
 *
 * 该模块同时被 electron-builder 配置（纯 JS）和 main 进程（TS，编译期注入的
 * ZCODE_PRODUCT_FLAVOR / ZCODE_PRODUCT_BRAND）使用，因此保持 .mjs 实现 + 这里声明。
 */
export type DesktopProductFlavor = "production" | "preview";

export interface DesktopProductIdentity {
  readonly flavor: DesktopProductFlavor;
  readonly appId: string;
  readonly productName: string;
  readonly linuxExecutableName: string;
  readonly linuxPackageName: string;
  readonly cuaHelperInstallVariant: string | null;
  readonly homepage?: string;
  readonly authorName?: string;
  readonly authorEmail?: string;
}

export const ZCODE_PREVIEW_IDENTITY_ENV: string;
export const desktopProductIdentities: Readonly<
  Record<DesktopProductFlavor, DesktopProductIdentity>
>;
export function isPreviewIdentityRequested(env?: Record<string, string | undefined>): boolean;
export function isProductBrandRequested(env?: Record<string, string | undefined>): boolean;
export function resolveDesktopProductFlavor(env?: Record<string, string | undefined>):
  DesktopProductFlavor;
export function resolveDesktopProductIdentityFromBuild(input: {
  flavor: DesktopProductFlavor;
  brand?: boolean;
}): DesktopProductIdentity;
export function resolveDesktopProductIdentity(
  env?: Record<string, string | undefined>,
): DesktopProductIdentity;
export function resolveDesktopArtifactSuffix(env?: Record<string, string | undefined>): string;
export function resolveWindowsAppUserModelIdForFlavor(
  flavor: DesktopProductFlavor,
  runtime?: { isPackaged?: boolean },
  brand?: boolean,
): string;
export function resolveWindowsAppUserModelId(
  env?: Record<string, string | undefined>,
  runtime?: { isPackaged?: boolean },
): string;
