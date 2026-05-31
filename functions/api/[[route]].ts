import app from '../../worker/app';

export const onRequest: PagesFunction = (context) =>
  app.fetch(context.request, context.env, context.executionCtx);
