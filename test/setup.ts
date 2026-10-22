// jsdom has no layout; CodeMirror measures text ranges, so give it empty geometry.
const rect = { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }

Range.prototype.getClientRects = () => ({ item: () => null, length: 0, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => rect as DOMRect
