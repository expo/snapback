"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probe = void 0;
const snapback2_1 = require("snapback2");
exports.probe = (0, snapback2_1.mutation)({ values: snapback2_1.t.list(snapback2_1.t.int(), { max: 2 }) }, ({ db, ctx, args }) => { args = { values: [3, 4] }; const box = { ...args }; return box; });
