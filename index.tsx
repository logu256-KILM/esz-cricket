import {createRoot} from 'react-dom/client';
import App from './App';

// Self-contained in immutable index.tsx so LLM edits to input.ts cannot break
// entrypoint imports or drop protection for @react-three/drei PointerLockControls.
const SAFE_POINTER_LOCK_PATCHED = '__playgroundSafePointerLockPatched__';

function ensureSafePointerLockPatch(): void {
  if (typeof Element === 'undefined' || !Element.prototype) return;
  try {
    if (Reflect.get(Element.prototype, SAFE_POINTER_LOCK_PATCHED)) return;
    const nativeRequestPointerLock = Element.prototype.requestPointerLock;
    if (typeof nativeRequestPointerLock !== 'function') return;
    Object.defineProperty(Element.prototype, SAFE_POINTER_LOCK_PATCHED, {
      value: true,
      configurable: true,
    });
    Element.prototype.requestPointerLock = function patchedRequestPointerLock(
      this: Element,
      ...args: Parameters<Element['requestPointerLock']>
    ): ReturnType<Element['requestPointerLock']> {
      try {
        const result = nativeRequestPointerLock.apply(this, args);
        Promise.resolve(result).catch(() => {});
        return result;
      } catch (err) {
        const rejected = Promise.reject(err);
        rejected.catch(() => {});
        return rejected;
      }
    };
  } catch {
    // Ignore frozen Element.prototype realms.
  }
}

ensureSafePointerLockPatch();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}
const root = createRoot(rootElement);

root.render(
  <div
    style={{
      position: 'relative',
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
    }}>
    <App />
  </div>,
);
