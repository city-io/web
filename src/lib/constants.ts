export const API_HOST = import.meta.env.VITE_API_HOST || 'https://api.cityio.prayujt.com';
export const WS_HOST = import.meta.env.VITE_WS_HOST || 'wss://api.cityio.prayujt.com';

export enum WS_CODE {
    PING = 1000,
    PONG = 1001,

    REQ_USER = 1100,
    USER = 1101,

    REQ_MAP = 2000,
    MAP = 2001,

    REQ_CITY = 2100,
    CITY = 2101,
}
