"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probe = void 0;
const snapback2_1 = require("snapback2");
const schema_1 = require("./schema");
exports.probe = (0, snapback2_1.mutation)({}, ({ db, ctx, args }) => { let xs = [1, 2]; xs = [...xs, 3]; for (const value of xs) {
    db.insert(schema_1.records, { id: ctx.newId(), payload: value });
} return { xs, next: ctx.newId() }; });
