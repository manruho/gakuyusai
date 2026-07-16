import { guardPage, type AuthEnv } from '../authGuard';

export const onRequest: PagesFunction<AuthEnv> = (context) => guardPage(context, 'admin');
