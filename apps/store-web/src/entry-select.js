// Trang chu 3dsmood.io.vn: trinh duyet thuong -> danh muc cong khai (chi xem); trong 3ds Max (WebView2) -> PluginApp nhu cu.
import { isAdminPath } from './admin-route.js';
import { isMaxHost } from './integrations/3dsmax/bridge.js';

export const isPublicSite = (pathname) => !isAdminPath(pathname) && !isMaxHost();
