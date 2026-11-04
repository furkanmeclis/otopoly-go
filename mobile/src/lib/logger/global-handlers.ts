import { createLogger } from './index';

const log = createLogger('global');
let installed = false;

type ErrorUtilsShape = {
  getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

/** Routes uncaught JS errors and unhandled promise rejections into the logger. Idempotent. */
export function installGlobalErrorHandlers() {
  if (installed) return;
  installed = true;

  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      log.error(isFatal ? 'Fatal uncaught error' : 'Uncaught error', error);
      previous(error, isFatal);
    });
  }

  const tracking = (globalThis as { HermesInternal?: { enablePromiseRejectionTracker?: (o: unknown) => void } })
    .HermesInternal;
  tracking?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (id: number, rejection: unknown) => log.error('Unhandled promise rejection', { id, rejection }),
    onHandled: (id: number) => log.debug('Promise rejection handled late', { id }),
  });

  log.info('Global error handlers installed');
}
