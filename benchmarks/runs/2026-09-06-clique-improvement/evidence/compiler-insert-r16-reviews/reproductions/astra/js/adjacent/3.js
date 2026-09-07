"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probe = void 0;
const snapback2_1 = require("snapback2");
exports.probe = (0, snapback2_1.mutation)({ zero: snapback2_1.t.int() }, ({ db, ctx, args }) => { let xs = [ctx.newId()]; xs = [...xs, (0, snapback2_1.divmod)(1, args.zero), ctx.newId()]; return { xs, next: ctx.newId() }; });
