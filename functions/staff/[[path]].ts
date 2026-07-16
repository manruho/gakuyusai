import { guardPage, type AuthEnv } from '../authGuard';

export const onRequest: PagesFunction<AuthEnv> = async (context) => {
  const pathname = new URL(context.request.url).pathname;
  return guardPage(context, pathname.startsWith('/staff/stock') ? 'stock' : 'staff');
};
