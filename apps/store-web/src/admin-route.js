// Plan v3 §P3: trang admin nam cung app o route /admin. `/administrator` hay `/admin-x` khong phai admin.
export const isAdminPath = (pathname) => /^\/admin(\/|$)/.test(String(pathname ?? ''));
