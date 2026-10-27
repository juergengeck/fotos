# Native console compatibility

The adjacent original patch is preserved byte-for-byte as the historical Fire
vendor contract. It replaces unsupported console.time/timeEnd calls with
Date.now and console.log around CoreModule initialization.

The current public ONE vger.core output already implements that behavior. The
normal installed public CoreModule was checked during this migration. Applying
the historical patch against those changed bytes is unnecessary and would fail
its old context. No owning emitted file is edited or patched in this consumer.

This does not qualify the unavailable historical vendor archive baseline in
Fotos issue 2, APK compilation, physical devices, or live sharing.
