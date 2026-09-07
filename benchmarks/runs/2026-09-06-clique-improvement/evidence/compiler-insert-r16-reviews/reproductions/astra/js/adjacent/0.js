"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probe = void 0;
const snapback2_1 = require("snapback2");
exports.probe = (0, snapback2_1.mutation)({}, ({ db, ctx, args }) => { let box = { length: 7 }; box = { length: 9 }; return box.length; });
