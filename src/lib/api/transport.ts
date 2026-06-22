import { createConnectTransport } from '@connectrpc/connect-web';
import { Code, ConnectError, type Interceptor } from '@connectrpc/connect';

import { handleUnauthenticated } from '$lib/session';

const authInterceptor: Interceptor = (next) => async (req) => {
  const token = localStorage.getItem('jwt-token');
  if (token) {
    req.header.set('Authorization', `Bearer ${token}`);
  }
  try {
    return await next(req);
  } catch (err) {
    // Any rejected session ends the same way: wipe state and bounce to login.
    if (err instanceof ConnectError && err.code === Code.Unauthenticated) {
      handleUnauthenticated();
    }
    throw err;
  }
};

const baseUrl = import.meta.env.VITE_API_HOST || 'https://api.cityio.prayujt.com';

export const transport = createConnectTransport({
  baseUrl,
  interceptors: [authInterceptor]
});
