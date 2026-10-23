// 浏览器调试入口：先装假 noteDesk，再加载真实应用入口（index.tsx 的 bootstrap）
import { installBrowserMock } from './lib/browserMock';

installBrowserMock();
void import('./index');
