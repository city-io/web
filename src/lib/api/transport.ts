import { createConnectTransport } from '@connectrpc/connect-web';
import type { Interceptor } from '@connectrpc/connect';

const authInterceptor: Interceptor = (next) => async (req) => {
	const token = localStorage.getItem('jwt-token');
	if (token) {
		req.header.set('Authorization', `Bearer ${token}`);
	}
	return next(req);
};

const baseUrl = import.meta.env.VITE_API_HOST || 'https://api.cityio.prayujt.com';

export const transport = createConnectTransport({
	baseUrl,
	interceptors: [authInterceptor]
});
