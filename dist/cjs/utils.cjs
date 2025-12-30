"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mid = mid;
exports.clamp = clamp;
function mid(a, b) {
    return (a + b) / 2;
}
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}
//# sourceMappingURL=utils.js.map