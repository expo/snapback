"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probe = void 0;
const snapback2_1 = require("snapback2");
const schema_1 = require("./schema");
exports.probe = (0, snapback2_1.mutation)({ payload: snapback2_1.t.json(100), flag: snapback2_1.t.bool() }, ({ db: writer, ctx, args }) => { let count = 0; for (const row of writer.scan(schema_1.records, [], { take: 2 })) {
    count++;
} return { count, next: ctx.newId() }; });
