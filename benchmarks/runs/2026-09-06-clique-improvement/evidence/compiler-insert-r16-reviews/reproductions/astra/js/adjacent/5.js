"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probe = void 0;
const snapback2_1 = require("snapback2");
exports.probe = (0, snapback2_1.mutation)({ payload: snapback2_1.t.json(100) }, ({ db, ctx, args }) => { ctx = args.payload; return ctx.newId(); });
