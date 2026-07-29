import * as _syscalls2_0 from "spacetime:sys@2.0";
import { moduleHooks } from "spacetime:sys@2.0";
import * as _syscalls2_1 from "spacetime:sys@2.1";

//#region node_modules/headers-polyfill/lib/index.mjs
var __create$1 = Object.create;
var __defProp$1 = Object.defineProperty;
var __getOwnPropDesc$1 = Object.getOwnPropertyDescriptor;
var __getOwnPropNames$1 = Object.getOwnPropertyNames;
var __getProtoOf$1 = Object.getPrototypeOf;
var __hasOwnProp$1 = Object.prototype.hasOwnProperty;
var __commonJS$1 = (cb, mod) => function __require() {
	return mod || (0, cb[__getOwnPropNames$1(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps$1 = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") {
		for (let key of __getOwnPropNames$1(from)) if (!__hasOwnProp$1.call(to, key) && key !== except) __defProp$1(to, key, {
			get: () => from[key],
			enumerable: !(desc = __getOwnPropDesc$1(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM$1 = (mod, isNodeMode, target) => (target = mod != null ? __create$1(__getProtoOf$1(mod)) : {}, __copyProps$1(isNodeMode || !mod || !mod.__esModule ? __defProp$1(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
var import_set_cookie_parser = __toESM$1(__commonJS$1({ "node_modules/set-cookie-parser/lib/set-cookie.js"(exports, module) {
	"use strict";
	var defaultParseOptions = {
		decodeValues: true,
		map: false,
		silent: false
	};
	function isNonEmptyString(str) {
		return typeof str === "string" && !!str.trim();
	}
	function parseString(setCookieValue, options) {
		var parts = setCookieValue.split(";").filter(isNonEmptyString);
		var parsed = parseNameValuePair(parts.shift());
		var name = parsed.name;
		var value = parsed.value;
		options = options ? Object.assign({}, defaultParseOptions, options) : defaultParseOptions;
		try {
			value = options.decodeValues ? decodeURIComponent(value) : value;
		} catch (e) {
			console.error("set-cookie-parser encountered an error while decoding a cookie with value '" + value + "'. Set options.decodeValues to false to disable this feature.", e);
		}
		var cookie = {
			name,
			value
		};
		parts.forEach(function(part) {
			var sides = part.split("=");
			var key = sides.shift().trimLeft().toLowerCase();
			var value2 = sides.join("=");
			if (key === "expires") cookie.expires = new Date(value2);
			else if (key === "max-age") cookie.maxAge = parseInt(value2, 10);
			else if (key === "secure") cookie.secure = true;
			else if (key === "httponly") cookie.httpOnly = true;
			else if (key === "samesite") cookie.sameSite = value2;
			else cookie[key] = value2;
		});
		return cookie;
	}
	function parseNameValuePair(nameValuePairStr) {
		var name = "";
		var value = "";
		var nameValueArr = nameValuePairStr.split("=");
		if (nameValueArr.length > 1) {
			name = nameValueArr.shift();
			value = nameValueArr.join("=");
		} else value = nameValuePairStr;
		return {
			name,
			value
		};
	}
	function parse(input, options) {
		options = options ? Object.assign({}, defaultParseOptions, options) : defaultParseOptions;
		if (!input) if (!options.map) return [];
		else return {};
		if (input.headers) if (typeof input.headers.getSetCookie === "function") input = input.headers.getSetCookie();
		else if (input.headers["set-cookie"]) input = input.headers["set-cookie"];
		else {
			var sch = input.headers[Object.keys(input.headers).find(function(key) {
				return key.toLowerCase() === "set-cookie";
			})];
			if (!sch && input.headers.cookie && !options.silent) console.warn("Warning: set-cookie-parser appears to have been called on a request object. It is designed to parse Set-Cookie headers from responses, not Cookie headers from requests. Set the option {silent: true} to suppress this warning.");
			input = sch;
		}
		if (!Array.isArray(input)) input = [input];
		options = options ? Object.assign({}, defaultParseOptions, options) : defaultParseOptions;
		if (!options.map) return input.filter(isNonEmptyString).map(function(str) {
			return parseString(str, options);
		});
		else return input.filter(isNonEmptyString).reduce(function(cookies2, str) {
			var cookie = parseString(str, options);
			cookies2[cookie.name] = cookie;
			return cookies2;
		}, {});
	}
	function splitCookiesString2(cookiesString) {
		if (Array.isArray(cookiesString)) return cookiesString;
		if (typeof cookiesString !== "string") return [];
		var cookiesStrings = [];
		var pos = 0;
		var start;
		var ch;
		var lastComma;
		var nextStart;
		var cookiesSeparatorFound;
		function skipWhitespace() {
			while (pos < cookiesString.length && /\s/.test(cookiesString.charAt(pos))) pos += 1;
			return pos < cookiesString.length;
		}
		function notSpecialChar() {
			ch = cookiesString.charAt(pos);
			return ch !== "=" && ch !== ";" && ch !== ",";
		}
		while (pos < cookiesString.length) {
			start = pos;
			cookiesSeparatorFound = false;
			while (skipWhitespace()) {
				ch = cookiesString.charAt(pos);
				if (ch === ",") {
					lastComma = pos;
					pos += 1;
					skipWhitespace();
					nextStart = pos;
					while (pos < cookiesString.length && notSpecialChar()) pos += 1;
					if (pos < cookiesString.length && cookiesString.charAt(pos) === "=") {
						cookiesSeparatorFound = true;
						pos = nextStart;
						cookiesStrings.push(cookiesString.substring(start, lastComma));
						start = pos;
					} else pos = lastComma + 1;
				} else pos += 1;
			}
			if (!cookiesSeparatorFound || pos >= cookiesString.length) cookiesStrings.push(cookiesString.substring(start, cookiesString.length));
		}
		return cookiesStrings;
	}
	module.exports = parse;
	module.exports.parse = parse;
	module.exports.parseString = parseString;
	module.exports.splitCookiesString = splitCookiesString2;
} })());
var HEADERS_INVALID_CHARACTERS = /[^a-z0-9\-#$%&'*+.^_`|~]/i;
function normalizeHeaderName(name) {
	if (HEADERS_INVALID_CHARACTERS.test(name) || name.trim() === "") throw new TypeError("Invalid character in header field name");
	return name.trim().toLowerCase();
}
var charCodesToRemove = [
	String.fromCharCode(10),
	String.fromCharCode(13),
	String.fromCharCode(9),
	String.fromCharCode(32)
];
var HEADER_VALUE_REMOVE_REGEXP = new RegExp(`(^[${charCodesToRemove.join("")}]|$[${charCodesToRemove.join("")}])`, "g");
function normalizeHeaderValue(value) {
	return value.replace(HEADER_VALUE_REMOVE_REGEXP, "");
}
function isValidHeaderName(value) {
	if (typeof value !== "string") return false;
	if (value.length === 0) return false;
	for (let i = 0; i < value.length; i++) {
		const character = value.charCodeAt(i);
		if (character > 127 || !isToken(character)) return false;
	}
	return true;
}
function isToken(value) {
	return ![
		127,
		32,
		"(",
		")",
		"<",
		">",
		"@",
		",",
		";",
		":",
		"\\",
		"\"",
		"/",
		"[",
		"]",
		"?",
		"=",
		"{",
		"}"
	].includes(value);
}
function isValidHeaderValue(value) {
	if (typeof value !== "string") return false;
	if (value.trim() !== value) return false;
	for (let i = 0; i < value.length; i++) {
		const character = value.charCodeAt(i);
		if (character === 0 || character === 10 || character === 13) return false;
	}
	return true;
}
var NORMALIZED_HEADERS = Symbol("normalizedHeaders");
var RAW_HEADER_NAMES = Symbol("rawHeaderNames");
var HEADER_VALUE_DELIMITER = ", ";
var _a, _b, _c;
var Headers = class _Headers {
	constructor(init) {
		this[_a] = {};
		this[_b] = /* @__PURE__ */ new Map();
		this[_c] = "Headers";
		if (["Headers", "HeadersPolyfill"].includes(init?.constructor.name) || init instanceof _Headers || typeof globalThis.Headers !== "undefined" && init instanceof globalThis.Headers) init.forEach((value, name) => {
			this.append(name, value);
		}, this);
		else if (Array.isArray(init)) init.forEach(([name, value]) => {
			this.append(name, Array.isArray(value) ? value.join(HEADER_VALUE_DELIMITER) : value);
		});
		else if (init) Object.getOwnPropertyNames(init).forEach((name) => {
			const value = init[name];
			this.append(name, Array.isArray(value) ? value.join(HEADER_VALUE_DELIMITER) : value);
		});
	}
	[(_a = NORMALIZED_HEADERS, _b = RAW_HEADER_NAMES, _c = Symbol.toStringTag, Symbol.iterator)]() {
		return this.entries();
	}
	*keys() {
		for (const [name] of this.entries()) yield name;
	}
	*values() {
		for (const [, value] of this.entries()) yield value;
	}
	*entries() {
		let sortedKeys = Object.keys(this[NORMALIZED_HEADERS]).sort((a, b) => a.localeCompare(b));
		for (const name of sortedKeys) if (name === "set-cookie") for (const value of this.getSetCookie()) yield [name, value];
		else yield [name, this.get(name)];
	}
	/**
	* Returns a boolean stating whether a `Headers` object contains a certain header.
	*/
	has(name) {
		if (!isValidHeaderName(name)) throw new TypeError(`Invalid header name "${name}"`);
		return this[NORMALIZED_HEADERS].hasOwnProperty(normalizeHeaderName(name));
	}
	/**
	* Returns a `ByteString` sequence of all the values of a header with a given name.
	*/
	get(name) {
		if (!isValidHeaderName(name)) throw TypeError(`Invalid header name "${name}"`);
		return this[NORMALIZED_HEADERS][normalizeHeaderName(name)] ?? null;
	}
	/**
	* Sets a new value for an existing header inside a `Headers` object, or adds the header if it does not already exist.
	*/
	set(name, value) {
		if (!isValidHeaderName(name) || !isValidHeaderValue(value)) return;
		const normalizedName = normalizeHeaderName(name);
		const normalizedValue = normalizeHeaderValue(value);
		this[NORMALIZED_HEADERS][normalizedName] = normalizeHeaderValue(normalizedValue);
		this[RAW_HEADER_NAMES].set(normalizedName, name);
	}
	/**
	* Appends a new value onto an existing header inside a `Headers` object, or adds the header if it does not already exist.
	*/
	append(name, value) {
		if (!isValidHeaderName(name) || !isValidHeaderValue(value)) return;
		const normalizedName = normalizeHeaderName(name);
		const normalizedValue = normalizeHeaderValue(value);
		let resolvedValue = this.has(normalizedName) ? `${this.get(normalizedName)}, ${normalizedValue}` : normalizedValue;
		this.set(name, resolvedValue);
	}
	/**
	* Deletes a header from the `Headers` object.
	*/
	delete(name) {
		if (!isValidHeaderName(name)) return;
		if (!this.has(name)) return;
		const normalizedName = normalizeHeaderName(name);
		delete this[NORMALIZED_HEADERS][normalizedName];
		this[RAW_HEADER_NAMES].delete(normalizedName);
	}
	/**
	* Traverses the `Headers` object,
	* calling the given callback for each header.
	*/
	forEach(callback, thisArg) {
		for (const [name, value] of this.entries()) callback.call(thisArg, value, name, this);
	}
	/**
	* Returns an array containing the values
	* of all Set-Cookie headers associated
	* with a response
	*/
	getSetCookie() {
		const setCookieHeader = this.get("set-cookie");
		if (setCookieHeader === null) return [];
		if (setCookieHeader === "") return [""];
		return (0, import_set_cookie_parser.splitCookiesString)(setCookieHeader);
	}
};
function headersToList(headers) {
	const headersList = [];
	headers.forEach((value, name) => {
		const resolvedValue = value.includes(",") ? value.split(",").map((value2) => value2.trim()) : value;
		headersList.push([name, resolvedValue]);
	});
	return headersList;
}

//#endregion
//#region node_modules/spacetimedb/dist/server/index.mjs
typeof globalThis !== "undefined" && (globalThis.global = globalThis.global || globalThis, globalThis.window = globalThis.window || globalThis);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
	return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
	return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
};
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") {
		for (let key of __getOwnPropNames(from)) if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: () => from[key],
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(__defProp(target, "default", {
	value: mod,
	enumerable: true
}), mod));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var require_base64_js = __commonJS({ "../../node_modules/.pnpm/base64-js@1.5.1/node_modules/base64-js/index.js"(exports) {
	exports.byteLength = byteLength;
	exports.toByteArray = toByteArray;
	exports.fromByteArray = fromByteArray2;
	var lookup = [];
	var revLookup = [];
	var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
	var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	for (i = 0, len = code.length; i < len; ++i) {
		lookup[i] = code[i];
		revLookup[code.charCodeAt(i)] = i;
	}
	var i;
	var len;
	revLookup["-".charCodeAt(0)] = 62;
	revLookup["_".charCodeAt(0)] = 63;
	function getLens(b64) {
		var len2 = b64.length;
		if (len2 % 4 > 0) throw new Error("Invalid string. Length must be a multiple of 4");
		var validLen = b64.indexOf("=");
		if (validLen === -1) validLen = len2;
		var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
		return [validLen, placeHoldersLen];
	}
	function byteLength(b64) {
		var lens = getLens(b64);
		var validLen = lens[0];
		var placeHoldersLen = lens[1];
		return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
	}
	function _byteLength(b64, validLen, placeHoldersLen) {
		return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
	}
	function toByteArray(b64) {
		var tmp;
		var lens = getLens(b64);
		var validLen = lens[0];
		var placeHoldersLen = lens[1];
		var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
		var curByte = 0;
		var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
		var i2;
		for (i2 = 0; i2 < len2; i2 += 4) {
			tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)];
			arr[curByte++] = tmp >> 16 & 255;
			arr[curByte++] = tmp >> 8 & 255;
			arr[curByte++] = tmp & 255;
		}
		if (placeHoldersLen === 2) {
			tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4;
			arr[curByte++] = tmp & 255;
		}
		if (placeHoldersLen === 1) {
			tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2;
			arr[curByte++] = tmp >> 8 & 255;
			arr[curByte++] = tmp & 255;
		}
		return arr;
	}
	function tripletToBase64(num) {
		return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
	}
	function encodeChunk(uint8, start, end) {
		var tmp;
		var output = [];
		for (var i2 = start; i2 < end; i2 += 3) {
			tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255);
			output.push(tripletToBase64(tmp));
		}
		return output.join("");
	}
	function fromByteArray2(uint8) {
		var tmp;
		var len2 = uint8.length;
		var extraBytes = len2 % 3;
		var parts = [];
		var maxChunkLength = 16383;
		for (var i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength) parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
		if (extraBytes === 1) {
			tmp = uint8[len2 - 1];
			parts.push(lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "==");
		} else if (extraBytes === 2) {
			tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
			parts.push(lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "=");
		}
		return parts.join("");
	}
} });
var require_codes = __commonJS({ "../../node_modules/.pnpm/statuses@2.0.2/node_modules/statuses/codes.json"(exports, module) {
	module.exports = {
		"100": "Continue",
		"101": "Switching Protocols",
		"102": "Processing",
		"103": "Early Hints",
		"200": "OK",
		"201": "Created",
		"202": "Accepted",
		"203": "Non-Authoritative Information",
		"204": "No Content",
		"205": "Reset Content",
		"206": "Partial Content",
		"207": "Multi-Status",
		"208": "Already Reported",
		"226": "IM Used",
		"300": "Multiple Choices",
		"301": "Moved Permanently",
		"302": "Found",
		"303": "See Other",
		"304": "Not Modified",
		"305": "Use Proxy",
		"307": "Temporary Redirect",
		"308": "Permanent Redirect",
		"400": "Bad Request",
		"401": "Unauthorized",
		"402": "Payment Required",
		"403": "Forbidden",
		"404": "Not Found",
		"405": "Method Not Allowed",
		"406": "Not Acceptable",
		"407": "Proxy Authentication Required",
		"408": "Request Timeout",
		"409": "Conflict",
		"410": "Gone",
		"411": "Length Required",
		"412": "Precondition Failed",
		"413": "Payload Too Large",
		"414": "URI Too Long",
		"415": "Unsupported Media Type",
		"416": "Range Not Satisfiable",
		"417": "Expectation Failed",
		"418": "I'm a Teapot",
		"421": "Misdirected Request",
		"422": "Unprocessable Entity",
		"423": "Locked",
		"424": "Failed Dependency",
		"425": "Too Early",
		"426": "Upgrade Required",
		"428": "Precondition Required",
		"429": "Too Many Requests",
		"431": "Request Header Fields Too Large",
		"451": "Unavailable For Legal Reasons",
		"500": "Internal Server Error",
		"501": "Not Implemented",
		"502": "Bad Gateway",
		"503": "Service Unavailable",
		"504": "Gateway Timeout",
		"505": "HTTP Version Not Supported",
		"506": "Variant Also Negotiates",
		"507": "Insufficient Storage",
		"508": "Loop Detected",
		"509": "Bandwidth Limit Exceeded",
		"510": "Not Extended",
		"511": "Network Authentication Required"
	};
} });
var require_statuses = __commonJS({ "../../node_modules/.pnpm/statuses@2.0.2/node_modules/statuses/index.js"(exports, module) {
	var codes = require_codes();
	module.exports = status2;
	status2.message = codes;
	status2.code = createMessageToStatusCodeMap(codes);
	status2.codes = createStatusCodeList(codes);
	status2.redirect = {
		300: true,
		301: true,
		302: true,
		303: true,
		305: true,
		307: true,
		308: true
	};
	status2.empty = {
		204: true,
		205: true,
		304: true
	};
	status2.retry = {
		502: true,
		503: true,
		504: true
	};
	function createMessageToStatusCodeMap(codes2) {
		var map = {};
		Object.keys(codes2).forEach(function forEachCode(code) {
			var message = codes2[code];
			var status3 = Number(code);
			map[message.toLowerCase()] = status3;
		});
		return map;
	}
	function createStatusCodeList(codes2) {
		return Object.keys(codes2).map(function mapCode(code) {
			return Number(code);
		});
	}
	function getStatusCode(message) {
		var msg = message.toLowerCase();
		if (!Object.prototype.hasOwnProperty.call(status2.code, msg)) throw new Error("invalid status message: \"" + message + "\"");
		return status2.code[msg];
	}
	function getStatusMessage(code) {
		if (!Object.prototype.hasOwnProperty.call(status2.message, code)) throw new Error("invalid status code: " + code);
		return status2.message[code];
	}
	function status2(code) {
		if (typeof code === "number") return getStatusMessage(code);
		if (typeof code !== "string") throw new TypeError("code must be a number or string");
		var n = parseInt(code, 10);
		if (!isNaN(n)) return getStatusMessage(n);
		return getStatusCode(code);
	}
} });
var util_stub_exports = {};
__export(util_stub_exports, { inspect: () => inspect });
var inspect;
var init_util_stub = __esm({ "src/util-stub.ts"() {
	inspect = {};
} });
var require_util_inspect = __commonJS({ "../../node_modules/.pnpm/object-inspect@1.13.4/node_modules/object-inspect/util.inspect.js"(exports, module) {
	module.exports = (init_util_stub(), __toCommonJS(util_stub_exports)).inspect;
} });
var require_object_inspect = __commonJS({ "../../node_modules/.pnpm/object-inspect@1.13.4/node_modules/object-inspect/index.js"(exports, module) {
	var hasMap = typeof Map === "function" && Map.prototype;
	var mapSizeDescriptor = Object.getOwnPropertyDescriptor && hasMap ? Object.getOwnPropertyDescriptor(Map.prototype, "size") : null;
	var mapSize = hasMap && mapSizeDescriptor && typeof mapSizeDescriptor.get === "function" ? mapSizeDescriptor.get : null;
	var mapForEach = hasMap && Map.prototype.forEach;
	var hasSet = typeof Set === "function" && Set.prototype;
	var setSizeDescriptor = Object.getOwnPropertyDescriptor && hasSet ? Object.getOwnPropertyDescriptor(Set.prototype, "size") : null;
	var setSize = hasSet && setSizeDescriptor && typeof setSizeDescriptor.get === "function" ? setSizeDescriptor.get : null;
	var setForEach = hasSet && Set.prototype.forEach;
	var weakMapHas = typeof WeakMap === "function" && WeakMap.prototype ? WeakMap.prototype.has : null;
	var weakSetHas = typeof WeakSet === "function" && WeakSet.prototype ? WeakSet.prototype.has : null;
	var weakRefDeref = typeof WeakRef === "function" && WeakRef.prototype ? WeakRef.prototype.deref : null;
	var booleanValueOf = Boolean.prototype.valueOf;
	var objectToString = Object.prototype.toString;
	var functionToString = Function.prototype.toString;
	var $match = String.prototype.match;
	var $slice = String.prototype.slice;
	var $replace = String.prototype.replace;
	var $toUpperCase = String.prototype.toUpperCase;
	var $toLowerCase = String.prototype.toLowerCase;
	var $test = RegExp.prototype.test;
	var $concat = Array.prototype.concat;
	var $join = Array.prototype.join;
	var $arrSlice = Array.prototype.slice;
	var $floor = Math.floor;
	var bigIntValueOf = typeof BigInt === "function" ? BigInt.prototype.valueOf : null;
	var gOPS = Object.getOwnPropertySymbols;
	var symToString = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? Symbol.prototype.toString : null;
	var hasShammedSymbols = typeof Symbol === "function" && typeof Symbol.iterator === "object";
	var toStringTag = typeof Symbol === "function" && Symbol.toStringTag && (typeof Symbol.toStringTag === hasShammedSymbols ? "object" : "symbol") ? Symbol.toStringTag : null;
	var isEnumerable = Object.prototype.propertyIsEnumerable;
	var gPO = (typeof Reflect === "function" ? Reflect.getPrototypeOf : Object.getPrototypeOf) || ([].__proto__ === Array.prototype ? function(O) {
		return O.__proto__;
	} : null);
	function addNumericSeparator(num, str) {
		if (num === Infinity || num === -Infinity || num !== num || num && num > -1e3 && num < 1e3 || $test.call(/e/, str)) return str;
		var sepRegex = /[0-9](?=(?:[0-9]{3})+(?![0-9]))/g;
		if (typeof num === "number") {
			var int = num < 0 ? -$floor(-num) : $floor(num);
			if (int !== num) {
				var intStr = String(int);
				var dec = $slice.call(str, intStr.length + 1);
				return $replace.call(intStr, sepRegex, "$&_") + "." + $replace.call($replace.call(dec, /([0-9]{3})/g, "$&_"), /_$/, "");
			}
		}
		return $replace.call(str, sepRegex, "$&_");
	}
	var utilInspect = require_util_inspect();
	var inspectCustom = utilInspect.custom;
	var inspectSymbol = isSymbol(inspectCustom) ? inspectCustom : null;
	var quotes = {
		__proto__: null,
		"double": "\"",
		single: "'"
	};
	var quoteREs = {
		__proto__: null,
		"double": /(["\\])/g,
		single: /(['\\])/g
	};
	module.exports = function inspect_(obj, options, depth, seen) {
		var opts = options || {};
		if (has(opts, "quoteStyle") && !has(quotes, opts.quoteStyle)) throw new TypeError("option \"quoteStyle\" must be \"single\" or \"double\"");
		if (has(opts, "maxStringLength") && (typeof opts.maxStringLength === "number" ? opts.maxStringLength < 0 && opts.maxStringLength !== Infinity : opts.maxStringLength !== null)) throw new TypeError("option \"maxStringLength\", if provided, must be a positive integer, Infinity, or `null`");
		var customInspect = has(opts, "customInspect") ? opts.customInspect : true;
		if (typeof customInspect !== "boolean" && customInspect !== "symbol") throw new TypeError("option \"customInspect\", if provided, must be `true`, `false`, or `'symbol'`");
		if (has(opts, "indent") && opts.indent !== null && opts.indent !== "	" && !(parseInt(opts.indent, 10) === opts.indent && opts.indent > 0)) throw new TypeError("option \"indent\" must be \"\\t\", an integer > 0, or `null`");
		if (has(opts, "numericSeparator") && typeof opts.numericSeparator !== "boolean") throw new TypeError("option \"numericSeparator\", if provided, must be `true` or `false`");
		var numericSeparator = opts.numericSeparator;
		if (typeof obj === "undefined") return "undefined";
		if (obj === null) return "null";
		if (typeof obj === "boolean") return obj ? "true" : "false";
		if (typeof obj === "string") return inspectString(obj, opts);
		if (typeof obj === "number") {
			if (obj === 0) return Infinity / obj > 0 ? "0" : "-0";
			var str = String(obj);
			return numericSeparator ? addNumericSeparator(obj, str) : str;
		}
		if (typeof obj === "bigint") {
			var bigIntStr = String(obj) + "n";
			return numericSeparator ? addNumericSeparator(obj, bigIntStr) : bigIntStr;
		}
		var maxDepth = typeof opts.depth === "undefined" ? 5 : opts.depth;
		if (typeof depth === "undefined") depth = 0;
		if (depth >= maxDepth && maxDepth > 0 && typeof obj === "object") return isArray(obj) ? "[Array]" : "[Object]";
		var indent = getIndent(opts, depth);
		if (typeof seen === "undefined") seen = [];
		else if (indexOf(seen, obj) >= 0) return "[Circular]";
		function inspect3(value, from, noIndent) {
			if (from) {
				seen = $arrSlice.call(seen);
				seen.push(from);
			}
			if (noIndent) {
				var newOpts = { depth: opts.depth };
				if (has(opts, "quoteStyle")) newOpts.quoteStyle = opts.quoteStyle;
				return inspect_(value, newOpts, depth + 1, seen);
			}
			return inspect_(value, opts, depth + 1, seen);
		}
		if (typeof obj === "function" && !isRegExp(obj)) {
			var name = nameOf(obj);
			var keys = arrObjKeys(obj, inspect3);
			return "[Function" + (name ? ": " + name : " (anonymous)") + "]" + (keys.length > 0 ? " { " + $join.call(keys, ", ") + " }" : "");
		}
		if (isSymbol(obj)) {
			var symString = hasShammedSymbols ? $replace.call(String(obj), /^(Symbol\(.*\))_[^)]*$/, "$1") : symToString.call(obj);
			return typeof obj === "object" && !hasShammedSymbols ? markBoxed(symString) : symString;
		}
		if (isElement(obj)) {
			var s = "<" + $toLowerCase.call(String(obj.nodeName));
			var attrs = obj.attributes || [];
			for (var i = 0; i < attrs.length; i++) s += " " + attrs[i].name + "=" + wrapQuotes(quote(attrs[i].value), "double", opts);
			s += ">";
			if (obj.childNodes && obj.childNodes.length) s += "...";
			s += "</" + $toLowerCase.call(String(obj.nodeName)) + ">";
			return s;
		}
		if (isArray(obj)) {
			if (obj.length === 0) return "[]";
			var xs = arrObjKeys(obj, inspect3);
			if (indent && !singleLineValues(xs)) return "[" + indentedJoin(xs, indent) + "]";
			return "[ " + $join.call(xs, ", ") + " ]";
		}
		if (isError(obj)) {
			var parts = arrObjKeys(obj, inspect3);
			if (!("cause" in Error.prototype) && "cause" in obj && !isEnumerable.call(obj, "cause")) return "{ [" + String(obj) + "] " + $join.call($concat.call("[cause]: " + inspect3(obj.cause), parts), ", ") + " }";
			if (parts.length === 0) return "[" + String(obj) + "]";
			return "{ [" + String(obj) + "] " + $join.call(parts, ", ") + " }";
		}
		if (typeof obj === "object" && customInspect) {
			if (inspectSymbol && typeof obj[inspectSymbol] === "function" && utilInspect) return utilInspect(obj, { depth: maxDepth - depth });
			else if (customInspect !== "symbol" && typeof obj.inspect === "function") return obj.inspect();
		}
		if (isMap(obj)) {
			var mapParts = [];
			if (mapForEach) mapForEach.call(obj, function(value, key) {
				mapParts.push(inspect3(key, obj, true) + " => " + inspect3(value, obj));
			});
			return collectionOf("Map", mapSize.call(obj), mapParts, indent);
		}
		if (isSet(obj)) {
			var setParts = [];
			if (setForEach) setForEach.call(obj, function(value) {
				setParts.push(inspect3(value, obj));
			});
			return collectionOf("Set", setSize.call(obj), setParts, indent);
		}
		if (isWeakMap(obj)) return weakCollectionOf("WeakMap");
		if (isWeakSet(obj)) return weakCollectionOf("WeakSet");
		if (isWeakRef(obj)) return weakCollectionOf("WeakRef");
		if (isNumber(obj)) return markBoxed(inspect3(Number(obj)));
		if (isBigInt(obj)) return markBoxed(inspect3(bigIntValueOf.call(obj)));
		if (isBoolean(obj)) return markBoxed(booleanValueOf.call(obj));
		if (isString(obj)) return markBoxed(inspect3(String(obj)));
		if (typeof window !== "undefined" && obj === window) return "{ [object Window] }";
		if (typeof globalThis !== "undefined" && obj === globalThis || typeof global !== "undefined" && obj === global) return "{ [object globalThis] }";
		if (!isDate(obj) && !isRegExp(obj)) {
			var ys = arrObjKeys(obj, inspect3);
			var isPlainObject = gPO ? gPO(obj) === Object.prototype : obj instanceof Object || obj.constructor === Object;
			var protoTag = obj instanceof Object ? "" : "null prototype";
			var stringTag = !isPlainObject && toStringTag && Object(obj) === obj && toStringTag in obj ? $slice.call(toStr(obj), 8, -1) : protoTag ? "Object" : "";
			var tag = (isPlainObject || typeof obj.constructor !== "function" ? "" : obj.constructor.name ? obj.constructor.name + " " : "") + (stringTag || protoTag ? "[" + $join.call($concat.call([], stringTag || [], protoTag || []), ": ") + "] " : "");
			if (ys.length === 0) return tag + "{}";
			if (indent) return tag + "{" + indentedJoin(ys, indent) + "}";
			return tag + "{ " + $join.call(ys, ", ") + " }";
		}
		return String(obj);
	};
	function wrapQuotes(s, defaultStyle, opts) {
		var quoteChar = quotes[opts.quoteStyle || defaultStyle];
		return quoteChar + s + quoteChar;
	}
	function quote(s) {
		return $replace.call(String(s), /"/g, "&quot;");
	}
	function canTrustToString(obj) {
		return !toStringTag || !(typeof obj === "object" && (toStringTag in obj || typeof obj[toStringTag] !== "undefined"));
	}
	function isArray(obj) {
		return toStr(obj) === "[object Array]" && canTrustToString(obj);
	}
	function isDate(obj) {
		return toStr(obj) === "[object Date]" && canTrustToString(obj);
	}
	function isRegExp(obj) {
		return toStr(obj) === "[object RegExp]" && canTrustToString(obj);
	}
	function isError(obj) {
		return toStr(obj) === "[object Error]" && canTrustToString(obj);
	}
	function isString(obj) {
		return toStr(obj) === "[object String]" && canTrustToString(obj);
	}
	function isNumber(obj) {
		return toStr(obj) === "[object Number]" && canTrustToString(obj);
	}
	function isBoolean(obj) {
		return toStr(obj) === "[object Boolean]" && canTrustToString(obj);
	}
	function isSymbol(obj) {
		if (hasShammedSymbols) return obj && typeof obj === "object" && obj instanceof Symbol;
		if (typeof obj === "symbol") return true;
		if (!obj || typeof obj !== "object" || !symToString) return false;
		try {
			symToString.call(obj);
			return true;
		} catch (e) {}
		return false;
	}
	function isBigInt(obj) {
		if (!obj || typeof obj !== "object" || !bigIntValueOf) return false;
		try {
			bigIntValueOf.call(obj);
			return true;
		} catch (e) {}
		return false;
	}
	var hasOwn2 = Object.prototype.hasOwnProperty || function(key) {
		return key in this;
	};
	function has(obj, key) {
		return hasOwn2.call(obj, key);
	}
	function toStr(obj) {
		return objectToString.call(obj);
	}
	function nameOf(f) {
		if (f.name) return f.name;
		var m = $match.call(functionToString.call(f), /^function\s*([\w$]+)/);
		if (m) return m[1];
		return null;
	}
	function indexOf(xs, x) {
		if (xs.indexOf) return xs.indexOf(x);
		for (var i = 0, l = xs.length; i < l; i++) if (xs[i] === x) return i;
		return -1;
	}
	function isMap(x) {
		if (!mapSize || !x || typeof x !== "object") return false;
		try {
			mapSize.call(x);
			try {
				setSize.call(x);
			} catch (s) {
				return true;
			}
			return x instanceof Map;
		} catch (e) {}
		return false;
	}
	function isWeakMap(x) {
		if (!weakMapHas || !x || typeof x !== "object") return false;
		try {
			weakMapHas.call(x, weakMapHas);
			try {
				weakSetHas.call(x, weakSetHas);
			} catch (s) {
				return true;
			}
			return x instanceof WeakMap;
		} catch (e) {}
		return false;
	}
	function isWeakRef(x) {
		if (!weakRefDeref || !x || typeof x !== "object") return false;
		try {
			weakRefDeref.call(x);
			return true;
		} catch (e) {}
		return false;
	}
	function isSet(x) {
		if (!setSize || !x || typeof x !== "object") return false;
		try {
			setSize.call(x);
			try {
				mapSize.call(x);
			} catch (m) {
				return true;
			}
			return x instanceof Set;
		} catch (e) {}
		return false;
	}
	function isWeakSet(x) {
		if (!weakSetHas || !x || typeof x !== "object") return false;
		try {
			weakSetHas.call(x, weakSetHas);
			try {
				weakMapHas.call(x, weakMapHas);
			} catch (s) {
				return true;
			}
			return x instanceof WeakSet;
		} catch (e) {}
		return false;
	}
	function isElement(x) {
		if (!x || typeof x !== "object") return false;
		if (typeof HTMLElement !== "undefined" && x instanceof HTMLElement) return true;
		return typeof x.nodeName === "string" && typeof x.getAttribute === "function";
	}
	function inspectString(str, opts) {
		if (str.length > opts.maxStringLength) {
			var remaining = str.length - opts.maxStringLength;
			var trailer = "... " + remaining + " more character" + (remaining > 1 ? "s" : "");
			return inspectString($slice.call(str, 0, opts.maxStringLength), opts) + trailer;
		}
		var quoteRE = quoteREs[opts.quoteStyle || "single"];
		quoteRE.lastIndex = 0;
		return wrapQuotes($replace.call($replace.call(str, quoteRE, "\\$1"), /[\x00-\x1f]/g, lowbyte), "single", opts);
	}
	function lowbyte(c) {
		var n = c.charCodeAt(0);
		var x = {
			8: "b",
			9: "t",
			10: "n",
			12: "f",
			13: "r"
		}[n];
		if (x) return "\\" + x;
		return "\\x" + (n < 16 ? "0" : "") + $toUpperCase.call(n.toString(16));
	}
	function markBoxed(str) {
		return "Object(" + str + ")";
	}
	function weakCollectionOf(type) {
		return type + " { ? }";
	}
	function collectionOf(type, size, entries, indent) {
		var joinedEntries = indent ? indentedJoin(entries, indent) : $join.call(entries, ", ");
		return type + " (" + size + ") {" + joinedEntries + "}";
	}
	function singleLineValues(xs) {
		for (var i = 0; i < xs.length; i++) if (indexOf(xs[i], "\n") >= 0) return false;
		return true;
	}
	function getIndent(opts, depth) {
		var baseIndent;
		if (opts.indent === "	") baseIndent = "	";
		else if (typeof opts.indent === "number" && opts.indent > 0) baseIndent = $join.call(Array(opts.indent + 1), " ");
		else return null;
		return {
			base: baseIndent,
			prev: $join.call(Array(depth + 1), baseIndent)
		};
	}
	function indentedJoin(xs, indent) {
		if (xs.length === 0) return "";
		var lineJoiner = "\n" + indent.prev + indent.base;
		return lineJoiner + $join.call(xs, "," + lineJoiner) + "\n" + indent.prev;
	}
	function arrObjKeys(obj, inspect3) {
		var isArr = isArray(obj);
		var xs = [];
		if (isArr) {
			xs.length = obj.length;
			for (var i = 0; i < obj.length; i++) xs[i] = has(obj, i) ? inspect3(obj[i], obj) : "";
		}
		var syms = typeof gOPS === "function" ? gOPS(obj) : [];
		var symMap;
		if (hasShammedSymbols) {
			symMap = {};
			for (var k = 0; k < syms.length; k++) symMap["$" + syms[k]] = syms[k];
		}
		for (var key in obj) {
			if (!has(obj, key)) continue;
			if (isArr && String(Number(key)) === key && key < obj.length) continue;
			if (hasShammedSymbols && symMap["$" + key] instanceof Symbol) continue;
			else if ($test.call(/[^\w$]/, key)) xs.push(inspect3(key, obj) + ": " + inspect3(obj[key], obj));
			else xs.push(key + ": " + inspect3(obj[key], obj));
		}
		if (typeof gOPS === "function") {
			for (var j = 0; j < syms.length; j++) if (isEnumerable.call(obj, syms[j])) xs.push("[" + inspect3(syms[j]) + "]: " + inspect3(obj[syms[j]], obj));
		}
		return xs;
	}
} });
var BinaryReader = class {
	/**
	* The DataView used to read values from the binary data.
	*
	* Note: The DataView's `byteOffset` is relative to the beginning of the
	* underlying ArrayBuffer, not the start of the provided Uint8Array input.
	* This `BinaryReader`'s `#offset` field is used to track the current read position
	* relative to the start of the provided Uint8Array input.
	*/
	view;
	/**
	* Represents the offset (in bytes) relative to the start of the DataView
	* and provided Uint8Array input.
	*
	* Note: This is *not* the absolute byte offset within the underlying ArrayBuffer.
	*/
	offset = 0;
	constructor(input) {
		this.view = input instanceof DataView ? input : new DataView(input.buffer, input.byteOffset, input.byteLength);
		this.offset = 0;
	}
	reset(input) {
		this.view = input instanceof DataView ? input : new DataView(input.buffer, input.byteOffset, input.byteLength);
		this.offset = 0;
	}
	get remaining() {
		return this.view.byteLength - this.offset;
	}
	/** Ensure we have at least `n` bytes left to read */
	#ensure(n) {
		if (this.offset + n > this.view.byteLength) throw new RangeError(`Tried to read ${n} byte(s) at relative offset ${this.offset}, but only ${this.remaining} byte(s) remain`);
	}
	readUInt8Array() {
		const length = this.readU32();
		this.#ensure(length);
		return this.readBytes(length);
	}
	readBool() {
		const value = this.view.getUint8(this.offset);
		this.offset += 1;
		return value !== 0;
	}
	readByte() {
		const value = this.view.getUint8(this.offset);
		this.offset += 1;
		return value;
	}
	readBytes(length) {
		const array = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
		this.offset += length;
		return array;
	}
	readI8() {
		const value = this.view.getInt8(this.offset);
		this.offset += 1;
		return value;
	}
	readU8() {
		return this.readByte();
	}
	readI16() {
		const value = this.view.getInt16(this.offset, true);
		this.offset += 2;
		return value;
	}
	readU16() {
		const value = this.view.getUint16(this.offset, true);
		this.offset += 2;
		return value;
	}
	readI32() {
		const value = this.view.getInt32(this.offset, true);
		this.offset += 4;
		return value;
	}
	readU32() {
		const value = this.view.getUint32(this.offset, true);
		this.offset += 4;
		return value;
	}
	readI64() {
		const value = this.view.getBigInt64(this.offset, true);
		this.offset += 8;
		return value;
	}
	readU64() {
		const value = this.view.getBigUint64(this.offset, true);
		this.offset += 8;
		return value;
	}
	readU128() {
		const lowerPart = this.view.getBigUint64(this.offset, true);
		const upperPart = this.view.getBigUint64(this.offset + 8, true);
		this.offset += 16;
		return (upperPart << BigInt(64)) + lowerPart;
	}
	readI128() {
		const lowerPart = this.view.getBigUint64(this.offset, true);
		const upperPart = this.view.getBigInt64(this.offset + 8, true);
		this.offset += 16;
		return (upperPart << BigInt(64)) + lowerPart;
	}
	readU256() {
		const p0 = this.view.getBigUint64(this.offset, true);
		const p1 = this.view.getBigUint64(this.offset + 8, true);
		const p2 = this.view.getBigUint64(this.offset + 16, true);
		const p3 = this.view.getBigUint64(this.offset + 24, true);
		this.offset += 32;
		return (p3 << BigInt(192)) + (p2 << BigInt(128)) + (p1 << BigInt(64)) + p0;
	}
	readI256() {
		const p0 = this.view.getBigUint64(this.offset, true);
		const p1 = this.view.getBigUint64(this.offset + 8, true);
		const p2 = this.view.getBigUint64(this.offset + 16, true);
		const p3 = this.view.getBigInt64(this.offset + 24, true);
		this.offset += 32;
		return (p3 << BigInt(192)) + (p2 << BigInt(128)) + (p1 << BigInt(64)) + p0;
	}
	readF32() {
		const value = this.view.getFloat32(this.offset, true);
		this.offset += 4;
		return value;
	}
	readF64() {
		const value = this.view.getFloat64(this.offset, true);
		this.offset += 8;
		return value;
	}
	readString() {
		const uint8Array = this.readUInt8Array();
		return new TextDecoder("utf-8").decode(uint8Array);
	}
};
var import_base64_js = __toESM(require_base64_js());
var ArrayBufferPrototypeTransfer = ArrayBuffer.prototype.transfer ?? function(newByteLength) {
	if (newByteLength === void 0) return this.slice();
	else if (newByteLength <= this.byteLength) return this.slice(0, newByteLength);
	else {
		const copy = new Uint8Array(newByteLength);
		copy.set(new Uint8Array(this));
		return copy.buffer;
	}
};
var ResizableBuffer = class {
	buffer;
	view;
	constructor(init) {
		this.buffer = typeof init === "number" ? new ArrayBuffer(init) : init;
		this.view = new DataView(this.buffer);
	}
	get capacity() {
		return this.buffer.byteLength;
	}
	grow(newSize) {
		if (newSize <= this.buffer.byteLength) return;
		this.buffer = ArrayBufferPrototypeTransfer.call(this.buffer, newSize);
		this.view = new DataView(this.buffer);
	}
};
var BinaryWriter = class {
	buffer;
	offset = 0;
	constructor(init) {
		this.buffer = typeof init === "number" ? new ResizableBuffer(init) : init;
	}
	clear() {
		this.offset = 0;
	}
	reset(buffer) {
		this.buffer = buffer;
		this.offset = 0;
	}
	expandBuffer(additionalCapacity) {
		const minCapacity = this.offset + additionalCapacity + 1;
		if (minCapacity <= this.buffer.capacity) return;
		let newCapacity = this.buffer.capacity * 2;
		if (newCapacity < minCapacity) newCapacity = minCapacity;
		this.buffer.grow(newCapacity);
	}
	toBase64() {
		return (0, import_base64_js.fromByteArray)(this.getBuffer());
	}
	getBuffer() {
		return new Uint8Array(this.buffer.buffer, 0, this.offset);
	}
	get view() {
		return this.buffer.view;
	}
	writeUInt8Array(value) {
		const length = value.length;
		this.expandBuffer(4 + length);
		this.writeU32(length);
		new Uint8Array(this.buffer.buffer, this.offset).set(value);
		this.offset += length;
	}
	writeBool(value) {
		this.expandBuffer(1);
		this.view.setUint8(this.offset, value ? 1 : 0);
		this.offset += 1;
	}
	writeByte(value) {
		this.expandBuffer(1);
		this.view.setUint8(this.offset, value);
		this.offset += 1;
	}
	writeBytes(value) {
		this.expandBuffer(value.length);
		new Uint8Array(this.buffer.buffer, this.offset, value.length).set(value);
		this.offset += value.length;
	}
	writeI8(value) {
		this.expandBuffer(1);
		this.view.setInt8(this.offset, value);
		this.offset += 1;
	}
	writeU8(value) {
		this.expandBuffer(1);
		this.view.setUint8(this.offset, value);
		this.offset += 1;
	}
	writeI16(value) {
		this.expandBuffer(2);
		this.view.setInt16(this.offset, value, true);
		this.offset += 2;
	}
	writeU16(value) {
		this.expandBuffer(2);
		this.view.setUint16(this.offset, value, true);
		this.offset += 2;
	}
	writeI32(value) {
		this.expandBuffer(4);
		this.view.setInt32(this.offset, value, true);
		this.offset += 4;
	}
	writeU32(value) {
		this.expandBuffer(4);
		this.view.setUint32(this.offset, value, true);
		this.offset += 4;
	}
	writeI64(value) {
		this.expandBuffer(8);
		this.view.setBigInt64(this.offset, value, true);
		this.offset += 8;
	}
	writeU64(value) {
		this.expandBuffer(8);
		this.view.setBigUint64(this.offset, value, true);
		this.offset += 8;
	}
	writeU128(value) {
		this.expandBuffer(16);
		const lowerPart = value & BigInt("0xFFFFFFFFFFFFFFFF");
		const upperPart = value >> BigInt(64);
		this.view.setBigUint64(this.offset, lowerPart, true);
		this.view.setBigUint64(this.offset + 8, upperPart, true);
		this.offset += 16;
	}
	writeI128(value) {
		this.expandBuffer(16);
		const lowerPart = value & BigInt("0xFFFFFFFFFFFFFFFF");
		const upperPart = value >> BigInt(64);
		this.view.setBigInt64(this.offset, lowerPart, true);
		this.view.setBigInt64(this.offset + 8, upperPart, true);
		this.offset += 16;
	}
	writeU256(value) {
		this.expandBuffer(32);
		const low_64_mask = BigInt("0xFFFFFFFFFFFFFFFF");
		const p0 = value & low_64_mask;
		const p1 = value >> BigInt(64) & low_64_mask;
		const p2 = value >> BigInt(128) & low_64_mask;
		const p3 = value >> BigInt(192);
		this.view.setBigUint64(this.offset + 0, p0, true);
		this.view.setBigUint64(this.offset + 8, p1, true);
		this.view.setBigUint64(this.offset + 16, p2, true);
		this.view.setBigUint64(this.offset + 24, p3, true);
		this.offset += 32;
	}
	writeI256(value) {
		this.expandBuffer(32);
		const low_64_mask = BigInt("0xFFFFFFFFFFFFFFFF");
		const p0 = value & low_64_mask;
		const p1 = value >> BigInt(64) & low_64_mask;
		const p2 = value >> BigInt(128) & low_64_mask;
		const p3 = value >> BigInt(192);
		this.view.setBigUint64(this.offset + 0, p0, true);
		this.view.setBigUint64(this.offset + 8, p1, true);
		this.view.setBigUint64(this.offset + 16, p2, true);
		this.view.setBigInt64(this.offset + 24, p3, true);
		this.offset += 32;
	}
	writeF32(value) {
		this.expandBuffer(4);
		this.view.setFloat32(this.offset, value, true);
		this.offset += 4;
	}
	writeF64(value) {
		this.expandBuffer(8);
		this.view.setFloat64(this.offset, value, true);
		this.offset += 8;
	}
	writeString(value) {
		const encodedString = new TextEncoder().encode(value);
		this.writeUInt8Array(encodedString);
	}
};
function uint8ArrayToHexString(array) {
	return Array.prototype.map.call(array.reverse(), (x) => ("00" + x.toString(16)).slice(-2)).join("");
}
function uint8ArrayToU128(array) {
	if (array.length != 16) throw new Error(`Uint8Array is not 16 bytes long: ${array}`);
	return new BinaryReader(array).readU128();
}
function uint8ArrayToU256(array) {
	if (array.length != 32) throw new Error(`Uint8Array is not 32 bytes long: [${array}]`);
	return new BinaryReader(array).readU256();
}
function hexStringToUint8Array(str) {
	if (str.startsWith("0x")) str = str.slice(2);
	const matches = str.match(/.{1,2}/g) || [];
	return Uint8Array.from(matches.map((byte) => parseInt(byte, 16))).reverse();
}
function hexStringToU128(str) {
	return uint8ArrayToU128(hexStringToUint8Array(str));
}
function hexStringToU256(str) {
	return uint8ArrayToU256(hexStringToUint8Array(str));
}
function u128ToUint8Array(data) {
	const writer = new BinaryWriter(16);
	writer.writeU128(data);
	return writer.getBuffer();
}
function u128ToHexString(data) {
	return uint8ArrayToHexString(u128ToUint8Array(data));
}
function u256ToUint8Array(data) {
	const writer = new BinaryWriter(32);
	writer.writeU256(data);
	return writer.getBuffer();
}
function u256ToHexString(data) {
	return uint8ArrayToHexString(u256ToUint8Array(data));
}
function coerceToBigInt(value, what) {
	if (typeof value === "bigint") return value;
	if (typeof value === "number") return BigInt(value);
	if (typeof value === "string" && value.trim() !== "") return BigInt(value);
	throw new TypeError(`Cannot convert ${typeof value} to ${what}: expected bigint, integer number, or decimal string`);
}
function toPascalCase(s) {
	const str = toCamelCase(s);
	return str.charAt(0).toUpperCase() + str.slice(1);
}
function toCamelCase(s) {
	const str = s.replace(/[-_]+/g, "_").replace(/_([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
	return str.charAt(0).toLowerCase() + str.slice(1);
}
function bsatnBaseSize(typespace, ty) {
	const assumedArrayLength = 4;
	while (ty.tag === "Ref") ty = typespace.types[ty.value];
	if (ty.tag === "Product") {
		let sum = 0;
		for (const { algebraicType: elem } of ty.value.elements) sum += bsatnBaseSize(typespace, elem);
		return sum;
	} else if (ty.tag === "Sum") {
		let min = Infinity;
		for (const { algebraicType: vari } of ty.value.variants) {
			const vSize = bsatnBaseSize(typespace, vari);
			if (vSize < min) min = vSize;
		}
		if (min === Infinity) min = 0;
		return 4 + min;
	} else if (ty.tag == "Array") return 4 + assumedArrayLength * bsatnBaseSize(typespace, ty.value);
	return {
		String: 4 + assumedArrayLength,
		Sum: 1,
		Bool: 1,
		I8: 1,
		U8: 1,
		I16: 2,
		U16: 2,
		I32: 4,
		U32: 4,
		F32: 4,
		I64: 8,
		U64: 8,
		F64: 8,
		I128: 16,
		U128: 16,
		I256: 32,
		U256: 32
	}[ty.tag];
}
var hasOwn = Object.hasOwn;
var TimeDuration = class _TimeDuration {
	__time_duration_micros__;
	static MICROS_PER_MILLIS = 1000n;
	/**
	* Get the algebraic type representation of the {@link TimeDuration} type.
	* @returns The algebraic type representation of the type.
	*/
	static getAlgebraicType() {
		return AlgebraicType.Product({ elements: [{
			name: "__time_duration_micros__",
			algebraicType: AlgebraicType.I64
		}] });
	}
	static isTimeDuration(algebraicType) {
		if (algebraicType.tag !== "Product") return false;
		const elements = algebraicType.value.elements;
		if (elements.length !== 1) return false;
		const microsElement = elements[0];
		return microsElement.name === "__time_duration_micros__" && microsElement.algebraicType.tag === "I64";
	}
	get micros() {
		return this.__time_duration_micros__;
	}
	get millis() {
		return Number(this.micros / _TimeDuration.MICROS_PER_MILLIS);
	}
	constructor(micros) {
		this.__time_duration_micros__ = coerceToBigInt(micros, "TimeDuration");
	}
	static fromMillis(millis) {
		return new _TimeDuration(BigInt(millis) * _TimeDuration.MICROS_PER_MILLIS);
	}
	/** This outputs the same string format that we use in the host and in Rust modules */
	toString() {
		const micros = this.micros;
		const sign = micros < 0 ? "-" : "+";
		const pos = micros < 0 ? -micros : micros;
		const secs = pos / 1000000n;
		const micros_remaining = pos % 1000000n;
		return `${sign}${secs}.${String(micros_remaining).padStart(6, "0")}`;
	}
};
var Timestamp = class _Timestamp {
	__timestamp_micros_since_unix_epoch__;
	static MICROS_PER_MILLIS = 1000n;
	get microsSinceUnixEpoch() {
		return this.__timestamp_micros_since_unix_epoch__;
	}
	constructor(micros) {
		this.__timestamp_micros_since_unix_epoch__ = coerceToBigInt(micros, "Timestamp");
	}
	/**
	* Get the algebraic type representation of the {@link Timestamp} type.
	* @returns The algebraic type representation of the type.
	*/
	static getAlgebraicType() {
		return AlgebraicType.Product({ elements: [{
			name: "__timestamp_micros_since_unix_epoch__",
			algebraicType: AlgebraicType.I64
		}] });
	}
	static isTimestamp(algebraicType) {
		if (algebraicType.tag !== "Product") return false;
		const elements = algebraicType.value.elements;
		if (elements.length !== 1) return false;
		const microsElement = elements[0];
		return microsElement.name === "__timestamp_micros_since_unix_epoch__" && microsElement.algebraicType.tag === "I64";
	}
	/**
	* The Unix epoch, the midnight at the beginning of January 1, 1970, UTC.
	*/
	static UNIX_EPOCH = new _Timestamp(0n);
	/**
	* Get a `Timestamp` representing the execution environment's belief of the current moment in time.
	*/
	static now() {
		return _Timestamp.fromDate(/* @__PURE__ */ new Date());
	}
	/** Convert to milliseconds since Unix epoch. */
	toMillis() {
		return this.microsSinceUnixEpoch / 1000n;
	}
	/**
	* Get a `Timestamp` representing the same point in time as `date`.
	*/
	static fromDate(date) {
		const millis = date.getTime();
		return new _Timestamp(BigInt(millis) * _Timestamp.MICROS_PER_MILLIS);
	}
	/**
	* Get a `Date` representing approximately the same point in time as `this`.
	*
	* This method truncates to millisecond precision,
	* and throws `RangeError` if the `Timestamp` is outside the range representable as a `Date`.
	*/
	toDate() {
		const millis = this.__timestamp_micros_since_unix_epoch__ / _Timestamp.MICROS_PER_MILLIS;
		if (millis > BigInt(Number.MAX_SAFE_INTEGER) || millis < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError("Timestamp is outside of the representable range of JS's Date");
		return new Date(Number(millis));
	}
	/**
	* Get an ISO 8601 / RFC 3339 formatted string representation of this timestamp with microsecond precision.
	*
	* This method preserves the full microsecond precision of the timestamp,
	* and throws `RangeError` if the `Timestamp` is outside the range representable in ISO format.
	*
	* @returns ISO 8601 formatted string with microsecond precision (e.g., '2025-02-17T10:30:45.123456Z')
	*/
	toISOString() {
		const micros = this.__timestamp_micros_since_unix_epoch__;
		const millis = micros / _Timestamp.MICROS_PER_MILLIS;
		if (millis > BigInt(Number.MAX_SAFE_INTEGER) || millis < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError("Timestamp is outside of the representable range for ISO string formatting");
		const isoBase = new Date(Number(millis)).toISOString();
		const microsRemainder = Math.abs(Number(micros % 1000000n));
		const fractionalPart = String(microsRemainder).padStart(6, "0");
		return isoBase.replace(/\.\d{3}Z$/, `.${fractionalPart}Z`);
	}
	since(other) {
		return new TimeDuration(this.__timestamp_micros_since_unix_epoch__ - other.__timestamp_micros_since_unix_epoch__);
	}
};
var Uuid = class _Uuid {
	__uuid__;
	/**
	* The nil UUID (all zeros).
	*
	* @example
	* ```ts
	* const uuid = Uuid.NIL;
	* console.assert(
	*   uuid.toString() === "00000000-0000-0000-0000-000000000000"
	* );
	* ```
	*/
	static NIL = new _Uuid(0n);
	static MAX_UUID_BIGINT = 340282366920938463463374607431768211455n;
	/**
	* The max UUID (all ones).
	*
	* @example
	* ```ts
	* const uuid = Uuid.MAX;
	* console.assert(
	*   uuid.toString() === "ffffffff-ffff-ffff-ffff-ffffffffffff"
	* );
	* ```
	*/
	static MAX = new _Uuid(_Uuid.MAX_UUID_BIGINT);
	/**
	* Create a UUID from a raw 128-bit value.
	*
	* @param u - Unsigned 128-bit integer
	* @throws {Error} If the value is outside the valid UUID range
	*/
	constructor(u) {
		const v = coerceToBigInt(u, "Uuid");
		if (v < 0n || v > _Uuid.MAX_UUID_BIGINT) throw new Error("Invalid UUID: must be between 0 and `MAX_UUID_BIGINT`");
		this.__uuid__ = v;
	}
	/**
	* Create a UUID `v4` from explicit random bytes.
	*
	* This method assumes the bytes are already sufficiently random.
	* It only sets the appropriate bits for the UUID version and variant.
	*
	* @param bytes - Exactly 16 random bytes
	* @returns A UUID `v4`
	* @throws {Error} If `bytes.length !== 16`
	*
	* @example
	* ```ts
	* const randomBytes = new Uint8Array(16);
	* const uuid = Uuid.fromRandomBytesV4(randomBytes);
	*
	* console.assert(
	*   uuid.toString() === "00000000-0000-4000-8000-000000000000"
	* );
	* ```
	*/
	static fromRandomBytesV4(bytes) {
		if (bytes.length !== 16) throw new Error("UUID v4 requires 16 bytes");
		const arr = new Uint8Array(bytes);
		arr[6] = arr[6] & 15 | 64;
		arr[8] = arr[8] & 63 | 128;
		return new _Uuid(_Uuid.bytesToBigInt(arr));
	}
	/**
	* Generate a UUID `v7` using a monotonic counter from `0` to `2^31 - 1`,
	* a timestamp, and 4 random bytes.
	*
	* The counter wraps around on overflow.
	*
	* The UUID `v7` is structured as follows:
	*
	* ```ascii
	* ┌───────────────────────────────────────────────┬───────────────────┐
	* | B0  | B1  | B2  | B3  | B4  | B5              |         B6        |
	* ├───────────────────────────────────────────────┼───────────────────┤
	* |                 unix_ts_ms                    |      version 7    |
	* └───────────────────────────────────────────────┴───────────────────┘
	* ┌──────────────┬─────────┬──────────────────┬───────────────────────┐
	* | B7           | B8      | B9  | B10 | B11  | B12 | B13 | B14 | B15 |
	* ├──────────────┼─────────┼──────────────────┼───────────────────────┤
	* | counter_high | variant |    counter_low   |        random         |
	* └──────────────┴─────────┴──────────────────┴───────────────────────┘
	* ```
	*
	* @param counter - Mutable monotonic counter (31-bit)
	* @param now - Timestamp since the Unix epoch
	* @param randomBytes - Exactly 4 random bytes
	* @returns A UUID `v7`
	*
	* @throws {Error} If the `counter` is negative
	* @throws {Error} If the `timestamp` is before the Unix epoch
	* @throws {Error} If `randomBytes.length !== 4`
	*
	* @example
	* ```ts
	* const now = Timestamp.fromMillis(1_686_000_000_000n);
	* const counter = { value: 1 };
	* const randomBytes = new Uint8Array(4);
	*
	* const uuid = Uuid.fromCounterV7(counter, now, randomBytes);
	*
	* console.assert(
	*   uuid.toString() === "0000647e-5180-7000-8000-000200000000"
	* );
	* ```
	*/
	static fromCounterV7(counter, now, randomBytes) {
		if (randomBytes.length !== 4) throw new Error("`fromCounterV7` requires `randomBytes.length == 4`");
		if (counter.value < 0) throw new Error("`fromCounterV7` uuid `counter` must be non-negative");
		if (now.__timestamp_micros_since_unix_epoch__ < 0) throw new Error("`fromCounterV7` `timestamp` before unix epoch");
		const counterVal = counter.value;
		counter.value = counterVal + 1 & 2147483647;
		const tsMs = now.toMillis() & 281474976710655n;
		const bytes = new Uint8Array(16);
		bytes[0] = Number(tsMs >> 40n & 255n);
		bytes[1] = Number(tsMs >> 32n & 255n);
		bytes[2] = Number(tsMs >> 24n & 255n);
		bytes[3] = Number(tsMs >> 16n & 255n);
		bytes[4] = Number(tsMs >> 8n & 255n);
		bytes[5] = Number(tsMs & 255n);
		bytes[7] = counterVal >>> 23 & 255;
		bytes[9] = counterVal >>> 15 & 255;
		bytes[10] = counterVal >>> 7 & 255;
		bytes[11] = (counterVal & 127) << 1 & 255;
		bytes[12] |= randomBytes[0] & 127;
		bytes[13] = randomBytes[1];
		bytes[14] = randomBytes[2];
		bytes[15] = randomBytes[3];
		bytes[6] = bytes[6] & 15 | 112;
		bytes[8] = bytes[8] & 63 | 128;
		return new _Uuid(_Uuid.bytesToBigInt(bytes));
	}
	/**
	* Parse a UUID from a string representation.
	*
	* @param s - UUID string
	* @returns Parsed UUID
	* @throws {Error} If the string is not a valid UUID
	*
	* @example
	* ```ts
	* const s = "01888d6e-5c00-7000-8000-000000000000";
	* const uuid = Uuid.parse(s);
	*
	* console.assert(uuid.toString() === s);
	* ```
	*/
	static parse(s) {
		const hex = s.replace(/-/g, "");
		if (hex.length !== 32) throw new Error("Invalid hex UUID");
		let v = 0n;
		for (let i = 0; i < 32; i += 2) v = v << 8n | BigInt(parseInt(hex.slice(i, i + 2), 16));
		return new _Uuid(v);
	}
	/** Convert to hex string without a 0x prefix. */
	toHexString() {
		return u128ToHexString(this.asBigInt());
	}
	/** Convert to string (hyphenated form). */
	toString() {
		const hex = this.toHexString();
		return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
	}
	/** Convert to bigint (u128). */
	asBigInt() {
		return this.__uuid__;
	}
	/** Return a `Uint8Array` of 16 bytes. */
	toBytes() {
		return _Uuid.bigIntToBytes(this.__uuid__);
	}
	static bytesToBigInt(bytes) {
		let result = 0n;
		for (const b of bytes) result = result << 8n | BigInt(b);
		return result;
	}
	static bigIntToBytes(value) {
		const bytes = new Uint8Array(16);
		for (let i = 15; i >= 0; i--) {
			bytes[i] = Number(value & 255n);
			value >>= 8n;
		}
		return bytes;
	}
	/**
	* Returns the version of this UUID.
	*
	* This represents the algorithm used to generate the value.
	*
	* @returns A `UuidVersion`
	* @throws {Error} If the version field is not recognized
	*/
	getVersion() {
		const version = this.toBytes()[6] >> 4 & 15;
		switch (version) {
			case 4: return "V4";
			case 7: return "V7";
			default:
				if (this == _Uuid.NIL) return "Nil";
				if (this == _Uuid.MAX) return "Max";
				throw new Error(`Unsupported UUID version: ${version}`);
		}
	}
	/**
	* Extract the monotonic counter from a UUIDv7.
	*
	* Intended for testing and diagnostics.
	* Behavior is undefined if called on a non-V7 UUID.
	*
	* @returns 31-bit counter value
	*/
	getCounter() {
		const bytes = this.toBytes();
		const high = bytes[7];
		const mid1 = bytes[9];
		const mid2 = bytes[10];
		const low = bytes[11] >>> 1;
		return high << 23 | mid1 << 15 | mid2 << 7 | low | 0;
	}
	compareTo(other) {
		if (this.__uuid__ < other.__uuid__) return -1;
		if (this.__uuid__ > other.__uuid__) return 1;
		return 0;
	}
	static getAlgebraicType() {
		return AlgebraicType.Product({ elements: [{
			name: "__uuid__",
			algebraicType: AlgebraicType.U128
		}] });
	}
};
var ConnectionId = class _ConnectionId {
	__connection_id__;
	/**
	* Creates a new `ConnectionId`.
	*/
	constructor(data) {
		this.__connection_id__ = coerceToBigInt(data, "ConnectionId");
	}
	/**
	* Get the algebraic type representation of the {@link ConnectionId} type.
	* @returns The algebraic type representation of the type.
	*/
	static getAlgebraicType() {
		return AlgebraicType.Product({ elements: [{
			name: "__connection_id__",
			algebraicType: AlgebraicType.U128
		}] });
	}
	isZero() {
		return this.__connection_id__ === BigInt(0);
	}
	static nullIfZero(addr) {
		if (addr.isZero()) return null;
		else return addr;
	}
	static random() {
		function randomU8() {
			return Math.floor(Math.random() * 255);
		}
		let result = BigInt(0);
		for (let i = 0; i < 16; i++) result = result << BigInt(8) | BigInt(randomU8());
		return new _ConnectionId(result);
	}
	/**
	* Compare two connection IDs for equality.
	*/
	isEqual(other) {
		return this.__connection_id__ == other.__connection_id__;
	}
	/**
	* Check if two connection IDs are equal.
	*/
	equals(other) {
		return this.isEqual(other);
	}
	/**
	* Print the connection ID as a hexadecimal string.
	*/
	toHexString() {
		return u128ToHexString(this.__connection_id__);
	}
	/**
	* Convert the connection ID to a Uint8Array.
	*/
	toUint8Array() {
		return u128ToUint8Array(this.__connection_id__);
	}
	/**
	* Parse a connection ID from a hexadecimal string.
	*/
	static fromString(str) {
		return new _ConnectionId(hexStringToU128(str));
	}
	static fromStringOrNull(str) {
		const addr = _ConnectionId.fromString(str);
		if (addr.isZero()) return null;
		else return addr;
	}
};
var Identity = class _Identity {
	__identity__;
	/**
	* Creates a new `Identity`.
	*
	* `data` can be a hexadecimal string or a `bigint`.
	*/
	constructor(data) {
		this.__identity__ = typeof data === "string" ? hexStringToU256(data) : coerceToBigInt(data, "Identity");
	}
	/**
	* Get the algebraic type representation of the {@link Identity} type.
	* @returns The algebraic type representation of the type.
	*/
	static getAlgebraicType() {
		return AlgebraicType.Product({ elements: [{
			name: "__identity__",
			algebraicType: AlgebraicType.U256
		}] });
	}
	/**
	* Check if two identities are equal.
	*/
	isEqual(other) {
		return this.toHexString() === other.toHexString();
	}
	/**
	* Check if two identities are equal.
	*/
	equals(other) {
		return this.isEqual(other);
	}
	/**
	* Print the identity as a hexadecimal string.
	*/
	toHexString() {
		return u256ToHexString(this.__identity__);
	}
	/**
	* Convert the address to a Uint8Array.
	*/
	toUint8Array() {
		return u256ToUint8Array(this.__identity__);
	}
	/**
	* Parse an Identity from a hexadecimal string.
	*/
	static fromString(str) {
		return new _Identity(str);
	}
	/**
	* Zero identity (0x0000000000000000000000000000000000000000000000000000000000000000)
	*/
	static zero() {
		return new _Identity(0n);
	}
	toString() {
		return this.toHexString();
	}
};
var SERIALIZERS = /* @__PURE__ */ new Map();
var DESERIALIZERS = /* @__PURE__ */ new Map();
var AlgebraicType = {
	Ref: (value) => ({
		tag: "Ref",
		value
	}),
	Sum: (value) => ({
		tag: "Sum",
		value
	}),
	Product: (value) => ({
		tag: "Product",
		value
	}),
	Array: (value) => ({
		tag: "Array",
		value
	}),
	String: { tag: "String" },
	Bool: { tag: "Bool" },
	I8: { tag: "I8" },
	U8: { tag: "U8" },
	I16: { tag: "I16" },
	U16: { tag: "U16" },
	I32: { tag: "I32" },
	U32: { tag: "U32" },
	I64: { tag: "I64" },
	U64: { tag: "U64" },
	I128: { tag: "I128" },
	U128: { tag: "U128" },
	I256: { tag: "I256" },
	U256: { tag: "U256" },
	F32: { tag: "F32" },
	F64: { tag: "F64" },
	makeSerializer(ty, typespace) {
		if (ty.tag === "Ref") {
			if (!typespace) throw new Error("cannot serialize refs without a typespace");
			while (ty.tag === "Ref") ty = typespace.types[ty.value];
		}
		switch (ty.tag) {
			case "Product": return ProductType.makeSerializer(ty.value, typespace);
			case "Sum": return SumType.makeSerializer(ty.value, typespace);
			case "Array": if (ty.value.tag === "U8") return serializeUint8Array;
			else {
				const serialize = AlgebraicType.makeSerializer(ty.value, typespace);
				return (writer, value) => {
					writer.writeU32(value.length);
					for (const elem of value) serialize(writer, elem);
				};
			}
			default: return primitiveSerializers[ty.tag];
		}
	},
	serializeValue(writer, ty, value, typespace) {
		AlgebraicType.makeSerializer(ty, typespace)(writer, value);
	},
	makeDeserializer(ty, typespace) {
		if (ty.tag === "Ref") {
			if (!typespace) throw new Error("cannot deserialize refs without a typespace");
			while (ty.tag === "Ref") ty = typespace.types[ty.value];
		}
		switch (ty.tag) {
			case "Product": return ProductType.makeDeserializer(ty.value, typespace);
			case "Sum": return SumType.makeDeserializer(ty.value, typespace);
			case "Array": if (ty.value.tag === "U8") return deserializeUint8Array;
			else {
				const deserialize = AlgebraicType.makeDeserializer(ty.value, typespace);
				return (reader) => {
					const length = reader.readU32();
					const result = Array(length);
					for (let i = 0; i < length; i++) result[i] = deserialize(reader);
					return result;
				};
			}
			default: return primitiveDeserializers[ty.tag];
		}
	},
	deserializeValue(reader, ty, typespace) {
		return AlgebraicType.makeDeserializer(ty, typespace)(reader);
	},
	intoMapKey: function(ty, value) {
		switch (ty.tag) {
			case "U8":
			case "U16":
			case "U32":
			case "U64":
			case "U128":
			case "U256":
			case "I8":
			case "I16":
			case "I32":
			case "I64":
			case "I128":
			case "I256":
			case "F32":
			case "F64":
			case "String":
			case "Bool": return value;
			case "Product": return ProductType.intoMapKey(ty.value, value);
			default: {
				const writer = new BinaryWriter(10);
				AlgebraicType.serializeValue(writer, ty, value);
				return writer.toBase64();
			}
		}
	}
};
function bindCall(f) {
	return Function.prototype.call.bind(f);
}
var primitiveSerializers = {
	Bool: bindCall(BinaryWriter.prototype.writeBool),
	I8: bindCall(BinaryWriter.prototype.writeI8),
	U8: bindCall(BinaryWriter.prototype.writeU8),
	I16: bindCall(BinaryWriter.prototype.writeI16),
	U16: bindCall(BinaryWriter.prototype.writeU16),
	I32: bindCall(BinaryWriter.prototype.writeI32),
	U32: bindCall(BinaryWriter.prototype.writeU32),
	I64: bindCall(BinaryWriter.prototype.writeI64),
	U64: bindCall(BinaryWriter.prototype.writeU64),
	I128: bindCall(BinaryWriter.prototype.writeI128),
	U128: bindCall(BinaryWriter.prototype.writeU128),
	I256: bindCall(BinaryWriter.prototype.writeI256),
	U256: bindCall(BinaryWriter.prototype.writeU256),
	F32: bindCall(BinaryWriter.prototype.writeF32),
	F64: bindCall(BinaryWriter.prototype.writeF64),
	String: bindCall(BinaryWriter.prototype.writeString)
};
Object.freeze(primitiveSerializers);
var serializeUint8Array = bindCall(BinaryWriter.prototype.writeUInt8Array);
var primitiveDeserializers = {
	Bool: bindCall(BinaryReader.prototype.readBool),
	I8: bindCall(BinaryReader.prototype.readI8),
	U8: bindCall(BinaryReader.prototype.readU8),
	I16: bindCall(BinaryReader.prototype.readI16),
	U16: bindCall(BinaryReader.prototype.readU16),
	I32: bindCall(BinaryReader.prototype.readI32),
	U32: bindCall(BinaryReader.prototype.readU32),
	I64: bindCall(BinaryReader.prototype.readI64),
	U64: bindCall(BinaryReader.prototype.readU64),
	I128: bindCall(BinaryReader.prototype.readI128),
	U128: bindCall(BinaryReader.prototype.readU128),
	I256: bindCall(BinaryReader.prototype.readI256),
	U256: bindCall(BinaryReader.prototype.readU256),
	F32: bindCall(BinaryReader.prototype.readF32),
	F64: bindCall(BinaryReader.prototype.readF64),
	String: bindCall(BinaryReader.prototype.readString)
};
Object.freeze(primitiveDeserializers);
var deserializeUint8Array = bindCall(BinaryReader.prototype.readUInt8Array);
var primitiveSizes = {
	Bool: 1,
	I8: 1,
	U8: 1,
	I16: 2,
	U16: 2,
	I32: 4,
	U32: 4,
	I64: 8,
	U64: 8,
	I128: 16,
	U128: 16,
	I256: 32,
	U256: 32,
	F32: 4,
	F64: 8
};
var fixedSizePrimitives = new Set(Object.keys(primitiveSizes));
var isFixedSizeProduct = (ty) => ty.elements.every(({ algebraicType }) => fixedSizePrimitives.has(algebraicType.tag));
var productSize = (ty) => ty.elements.reduce((acc, { algebraicType }) => acc + primitiveSizes[algebraicType.tag], 0);
var primitiveJSName = {
	Bool: "Uint8",
	I8: "Int8",
	U8: "Uint8",
	I16: "Int16",
	U16: "Uint16",
	I32: "Int32",
	U32: "Uint32",
	I64: "BigInt64",
	U64: "BigUint64",
	F32: "Float32",
	F64: "Float64"
};
var specialProductDeserializers = {
	__time_duration_micros__: (reader) => new TimeDuration(reader.readI64()),
	__timestamp_micros_since_unix_epoch__: (reader) => new Timestamp(reader.readI64()),
	__identity__: (reader) => new Identity(reader.readU256()),
	__connection_id__: (reader) => new ConnectionId(reader.readU128()),
	__uuid__: (reader) => new Uuid(reader.readU128())
};
Object.freeze(specialProductDeserializers);
var unitDeserializer = () => ({});
var getElementInitializer = (element) => {
	let init;
	switch (element.algebraicType.tag) {
		case "String":
			init = "''";
			break;
		case "Bool":
			init = "false";
			break;
		case "I8":
		case "U8":
		case "I16":
		case "U16":
		case "I32":
		case "U32":
			init = "0";
			break;
		case "I64":
		case "U64":
		case "I128":
		case "U128":
		case "I256":
		case "U256":
			init = "0n";
			break;
		case "F32":
		case "F64":
			init = "0.0";
			break;
		default: init = "undefined";
	}
	return `${element.name}: ${init}`;
};
var ProductType = {
	makeSerializer(ty, typespace) {
		let serializer = SERIALIZERS.get(ty);
		if (serializer != null) return serializer;
		if (isFixedSizeProduct(ty)) {
			const body2 = `"use strict";
writer.expandBuffer(${productSize(ty)});
const view = writer.view;
${ty.elements.map(({ name, algebraicType: { tag } }) => tag in primitiveJSName ? `view.set${primitiveJSName[tag]}(writer.offset, value.${name}, ${primitiveSizes[tag] > 1 ? "true" : ""});
writer.offset += ${primitiveSizes[tag]};` : `writer.write${tag}(value.${name});`).join("\n")}`;
			serializer = Function("writer", "value", body2);
			SERIALIZERS.set(ty, serializer);
			return serializer;
		}
		const serializers = {};
		const body = "\"use strict\";\n" + ty.elements.map((element) => `this.${element.name}(writer, value.${element.name});`).join("\n");
		serializer = Function("writer", "value", body).bind(serializers);
		SERIALIZERS.set(ty, serializer);
		for (const { name, algebraicType } of ty.elements) serializers[name] = AlgebraicType.makeSerializer(algebraicType, typespace);
		Object.freeze(serializers);
		return serializer;
	},
	serializeValue(writer, ty, value, typespace) {
		ProductType.makeSerializer(ty, typespace)(writer, value);
	},
	makeDeserializer(ty, typespace) {
		switch (ty.elements.length) {
			case 0: return unitDeserializer;
			case 1: {
				const fieldName = ty.elements[0].name;
				if (hasOwn(specialProductDeserializers, fieldName)) return specialProductDeserializers[fieldName];
			}
		}
		let deserializer = DESERIALIZERS.get(ty);
		if (deserializer != null) return deserializer;
		if (isFixedSizeProduct(ty)) {
			const body = `"use strict";
const result = { ${ty.elements.map(getElementInitializer).join(", ")} };
const view = reader.view;
${ty.elements.map(({ name, algebraicType: { tag } }) => tag in primitiveJSName ? tag === "Bool" ? `result.${name} = view.getUint8(reader.offset) !== 0;
reader.offset += 1;` : `result.${name} = view.get${primitiveJSName[tag]}(reader.offset, ${primitiveSizes[tag] > 1 ? "true" : ""});
reader.offset += ${primitiveSizes[tag]};` : `result.${name} = reader.read${tag}();`).join("\n")}
return result;`;
			deserializer = Function("reader", body);
			DESERIALIZERS.set(ty, deserializer);
			return deserializer;
		}
		const deserializers = {};
		deserializer = Function("reader", `"use strict";
const result = { ${ty.elements.map(getElementInitializer).join(", ")} };
${ty.elements.map(({ name }) => `result.${name} = this.${name}(reader);`).join("\n")}
return result;`).bind(deserializers);
		DESERIALIZERS.set(ty, deserializer);
		for (const { name, algebraicType } of ty.elements) deserializers[name] = AlgebraicType.makeDeserializer(algebraicType, typespace);
		Object.freeze(deserializers);
		return deserializer;
	},
	deserializeValue(reader, ty, typespace) {
		return ProductType.makeDeserializer(ty, typespace)(reader);
	},
	intoMapKey(ty, value) {
		if (ty.elements.length === 1) {
			const fieldName = ty.elements[0].name;
			if (hasOwn(specialProductDeserializers, fieldName)) return value[fieldName];
		}
		const writer = new BinaryWriter(10);
		AlgebraicType.serializeValue(writer, AlgebraicType.Product(ty), value);
		return writer.toBase64();
	}
};
var SumType = {
	makeSerializer(ty, typespace) {
		if (ty.variants.length == 2 && ty.variants[0].name === "some" && ty.variants[1].name === "none") {
			const serialize = AlgebraicType.makeSerializer(ty.variants[0].algebraicType, typespace);
			return (writer, value) => {
				if (value !== null && value !== void 0) {
					writer.writeByte(0);
					serialize(writer, value);
				} else writer.writeByte(1);
			};
		} else if (ty.variants.length == 2 && ty.variants[0].name === "ok" && ty.variants[1].name === "err") {
			const serializeOk = AlgebraicType.makeSerializer(ty.variants[0].algebraicType, typespace);
			const serializeErr = AlgebraicType.makeSerializer(ty.variants[0].algebraicType, typespace);
			return (writer, value) => {
				if ("ok" in value) {
					writer.writeU8(0);
					serializeOk(writer, value.ok);
				} else if ("err" in value) {
					writer.writeU8(1);
					serializeErr(writer, value.err);
				} else throw new TypeError("could not serialize result: object had neither a `ok` nor an `err` field");
			};
		} else {
			let serializer = SERIALIZERS.get(ty);
			if (serializer != null) return serializer;
			const serializers = {};
			const body = `switch (value.tag) {
${ty.variants.map(({ name }, i) => `  case ${JSON.stringify(name)}:
    writer.writeByte(${i});
    return this.${name}(writer, value.value);`).join("\n")}
  default:
    throw new TypeError(
      \`Could not serialize sum type; unknown tag \${value.tag}\`
    )
}
`;
			serializer = Function("writer", "value", body).bind(serializers);
			SERIALIZERS.set(ty, serializer);
			for (const { name, algebraicType } of ty.variants) serializers[name] = AlgebraicType.makeSerializer(algebraicType, typespace);
			Object.freeze(serializers);
			return serializer;
		}
	},
	serializeValue(writer, ty, value, typespace) {
		SumType.makeSerializer(ty, typespace)(writer, value);
	},
	makeDeserializer(ty, typespace) {
		if (ty.variants.length == 2 && ty.variants[0].name === "some" && ty.variants[1].name === "none") {
			const deserialize = AlgebraicType.makeDeserializer(ty.variants[0].algebraicType, typespace);
			return (reader) => {
				const tag = reader.readU8();
				if (tag === 0) return deserialize(reader);
				else if (tag === 1) return;
				else throw `Can't deserialize an option type, couldn't find ${tag} tag`;
			};
		} else if (ty.variants.length == 2 && ty.variants[0].name === "ok" && ty.variants[1].name === "err") {
			const deserializeOk = AlgebraicType.makeDeserializer(ty.variants[0].algebraicType, typespace);
			const deserializeErr = AlgebraicType.makeDeserializer(ty.variants[1].algebraicType, typespace);
			return (reader) => {
				const tag = reader.readByte();
				if (tag === 0) return { ok: deserializeOk(reader) };
				else if (tag === 1) return { err: deserializeErr(reader) };
				else throw `Can't deserialize a result type, couldn't find ${tag} tag`;
			};
		} else {
			let deserializer = DESERIALIZERS.get(ty);
			if (deserializer != null) return deserializer;
			const deserializers = {};
			deserializer = Function("reader", `switch (reader.readU8()) {
${ty.variants.map(({ name }, i) => `case ${i}: return { tag: ${JSON.stringify(name)}, value: this.${name}(reader) };`).join("\n")} }`).bind(deserializers);
			DESERIALIZERS.set(ty, deserializer);
			for (const { name, algebraicType } of ty.variants) deserializers[name] = AlgebraicType.makeDeserializer(algebraicType, typespace);
			Object.freeze(deserializers);
			return deserializer;
		}
	},
	deserializeValue(reader, ty, typespace) {
		return SumType.makeDeserializer(ty, typespace)(reader);
	}
};
var Option = { getAlgebraicType(innerType) {
	return AlgebraicType.Sum({ variants: [{
		name: "some",
		algebraicType: innerType
	}, {
		name: "none",
		algebraicType: AlgebraicType.Product({ elements: [] })
	}] });
} };
var Result = { getAlgebraicType(okType, errType) {
	return AlgebraicType.Sum({ variants: [{
		name: "ok",
		algebraicType: okType
	}, {
		name: "err",
		algebraicType: errType
	}] });
} };
var ScheduleAt = {
	interval(value) {
		return Interval(value);
	},
	time(value) {
		return Time(value);
	},
	getAlgebraicType() {
		return AlgebraicType.Sum({ variants: [{
			name: "Interval",
			algebraicType: TimeDuration.getAlgebraicType()
		}, {
			name: "Time",
			algebraicType: Timestamp.getAlgebraicType()
		}] });
	},
	isScheduleAt(algebraicType) {
		if (algebraicType.tag !== "Sum") return false;
		const variants = algebraicType.value.variants;
		if (variants.length !== 2) return false;
		const intervalVariant = variants.find((v) => v.name === "Interval");
		const timeVariant = variants.find((v) => v.name === "Time");
		if (!intervalVariant || !timeVariant) return false;
		return TimeDuration.isTimeDuration(intervalVariant.algebraicType) && Timestamp.isTimestamp(timeVariant.algebraicType);
	}
};
var Interval = (micros) => ({
	tag: "Interval",
	value: new TimeDuration(micros)
});
var Time = (microsSinceUnixEpoch) => ({
	tag: "Time",
	value: new Timestamp(microsSinceUnixEpoch)
});
var schedule_at_default = ScheduleAt;
function set(x, t2) {
	return {
		...x,
		...t2
	};
}
var TypeBuilder = class {
	/**
	* The TypeScript phantom type. This is not stored at runtime,
	* but is visible to the compiler
	*/
	type;
	/**
	* The SpacetimeDB algebraic type (run‑time value). In addition to storing
	* the runtime representation of the `AlgebraicType`, it also captures
	* the TypeScript type information of the `AlgebraicType`. That is to say
	* the value is not merely an `AlgebraicType`, but is constructed to be
	* the corresponding concrete `AlgebraicType` for the TypeScript type `Type`.
	*
	* e.g. `string` corresponds to `AlgebraicType.String`
	*/
	algebraicType;
	constructor(algebraicType) {
		this.algebraicType = algebraicType;
	}
	optional() {
		return new OptionBuilder(this);
	}
	serialize(writer, value) {
		(this.serialize = AlgebraicType.makeSerializer(this.algebraicType))(writer, value);
	}
	deserialize(reader) {
		return (this.deserialize = AlgebraicType.makeDeserializer(this.algebraicType))(reader);
	}
};
var U8Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.U8);
	}
	index(algorithm = "btree") {
		return new U8ColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new U8ColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new U8ColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new U8ColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new U8ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new U8ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var U16Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.U16);
	}
	index(algorithm = "btree") {
		return new U16ColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new U16ColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new U16ColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new U16ColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new U16ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new U16ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var U32Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.U32);
	}
	index(algorithm = "btree") {
		return new U32ColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new U32ColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new U32ColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new U32ColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new U32ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new U32ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var U64Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.U64);
	}
	index(algorithm = "btree") {
		return new U64ColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new U64ColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new U64ColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new U64ColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new U64ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new U64ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var U128Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.U128);
	}
	index(algorithm = "btree") {
		return new U128ColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new U128ColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new U128ColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new U128ColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new U128ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new U128ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var U256Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.U256);
	}
	index(algorithm = "btree") {
		return new U256ColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new U256ColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new U256ColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new U256ColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new U256ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new U256ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var I8Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.I8);
	}
	index(algorithm = "btree") {
		return new I8ColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new I8ColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new I8ColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new I8ColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new I8ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new I8ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var I16Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.I16);
	}
	index(algorithm = "btree") {
		return new I16ColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new I16ColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new I16ColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new I16ColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new I16ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new I16ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var I32Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.I32);
	}
	index(algorithm = "btree") {
		return new I32ColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new I32ColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new I32ColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new I32ColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new I32ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new I32ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var I64Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.I64);
	}
	index(algorithm = "btree") {
		return new I64ColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new I64ColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new I64ColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new I64ColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new I64ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new I64ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var I128Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.I128);
	}
	index(algorithm = "btree") {
		return new I128ColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new I128ColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new I128ColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new I128ColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new I128ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new I128ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var I256Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.I256);
	}
	index(algorithm = "btree") {
		return new I256ColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new I256ColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new I256ColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new I256ColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new I256ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new I256ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var F32Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.F32);
	}
	default(value) {
		return new F32ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new F32ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var F64Builder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.F64);
	}
	default(value) {
		return new F64ColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new F64ColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var BoolBuilder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.Bool);
	}
	index(algorithm = "btree") {
		return new BoolColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new BoolColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new BoolColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	default(value) {
		return new BoolColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new BoolColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var StringBuilder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.String);
	}
	index(algorithm = "btree") {
		return new StringColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new StringColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new StringColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	default(value) {
		return new StringColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new StringColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var ArrayBuilder = class extends TypeBuilder {
	element;
	constructor(element) {
		super(AlgebraicType.Array(element.algebraicType));
		this.element = element;
	}
	default(value) {
		return new ArrayColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new ArrayColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var ByteArrayBuilder = class extends TypeBuilder {
	constructor() {
		super(AlgebraicType.Array(AlgebraicType.U8));
	}
	default(value) {
		return new ByteArrayColumnBuilder(set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new ByteArrayColumnBuilder(set(defaultMetadata, { name }));
	}
};
var OptionBuilder = class extends TypeBuilder {
	value;
	constructor(value) {
		super(Option.getAlgebraicType(value.algebraicType));
		this.value = value;
	}
	default(value) {
		return new OptionColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new OptionColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var ProductBuilder = class extends TypeBuilder {
	typeName;
	elements;
	constructor(elements, name) {
		function elementsArrayFromElementsObj(obj) {
			return Object.keys(obj).map((key) => ({
				name: key,
				get algebraicType() {
					return obj[key].algebraicType;
				}
			}));
		}
		super(AlgebraicType.Product({ elements: elementsArrayFromElementsObj(elements) }));
		this.typeName = name;
		this.elements = elements;
	}
	default(value) {
		return new ProductColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new ProductColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var ResultBuilder = class extends TypeBuilder {
	ok;
	err;
	constructor(ok, err) {
		super(Result.getAlgebraicType(ok.algebraicType, err.algebraicType));
		this.ok = ok;
		this.err = err;
	}
	default(value) {
		return new ResultColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
};
var UnitBuilder = class extends TypeBuilder {
	constructor() {
		super({
			tag: "Product",
			value: { elements: [] }
		});
	}
};
var RowBuilder = class extends TypeBuilder {
	row;
	typeName;
	constructor(row, name) {
		const mappedRow = Object.fromEntries(Object.entries(row).map(([colName, builder]) => [colName, builder instanceof ColumnBuilder ? builder : new ColumnBuilder(builder, {})]));
		const elements = Object.keys(mappedRow).map((name2) => ({
			name: name2,
			get algebraicType() {
				return mappedRow[name2].typeBuilder.algebraicType;
			}
		}));
		super(AlgebraicType.Product({ elements }));
		this.row = mappedRow;
		this.typeName = name;
	}
};
var SumBuilderImpl = class extends TypeBuilder {
	variants;
	typeName;
	constructor(variants, name) {
		function variantsArrayFromVariantsObj(variants2) {
			return Object.keys(variants2).map((key) => ({
				name: key,
				get algebraicType() {
					return variants2[key].algebraicType;
				}
			}));
		}
		super(AlgebraicType.Sum({ variants: variantsArrayFromVariantsObj(variants) }));
		this.variants = variants;
		this.typeName = name;
		for (const key of Object.keys(variants)) {
			const desc = Object.getOwnPropertyDescriptor(variants, key);
			const isAccessor = !!desc && (typeof desc.get === "function" || typeof desc.set === "function");
			let isUnit2 = false;
			if (!isAccessor) isUnit2 = variants[key] instanceof UnitBuilder;
			if (isUnit2) {
				const constant = this.create(key);
				Object.defineProperty(this, key, {
					value: constant,
					writable: false,
					enumerable: true,
					configurable: false
				});
			} else {
				const fn = ((value) => this.create(key, value));
				Object.defineProperty(this, key, {
					value: fn,
					writable: false,
					enumerable: true,
					configurable: false
				});
			}
		}
	}
	create(tag, value) {
		return value === void 0 ? { tag } : {
			tag,
			value
		};
	}
	default(value) {
		return new SumColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new SumColumnBuilder(this, set(defaultMetadata, { name }));
	}
	index(algorithm = "btree") {
		return new SumColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	primaryKey() {
		return new SumColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
};
var SumBuilder = SumBuilderImpl;
var SimpleSumBuilderImpl = class extends SumBuilderImpl {
	index(algorithm = "btree") {
		return new SimpleSumColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	primaryKey() {
		return new SimpleSumColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
};
var ScheduleAtBuilder = class extends TypeBuilder {
	constructor() {
		super(schedule_at_default.getAlgebraicType());
	}
	default(value) {
		return new ScheduleAtColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new ScheduleAtColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var IdentityBuilder = class extends TypeBuilder {
	constructor() {
		super(Identity.getAlgebraicType());
	}
	index(algorithm = "btree") {
		return new IdentityColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new IdentityColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new IdentityColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new IdentityColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new IdentityColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new IdentityColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var ConnectionIdBuilder = class extends TypeBuilder {
	constructor() {
		super(ConnectionId.getAlgebraicType());
	}
	index(algorithm = "btree") {
		return new ConnectionIdColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new ConnectionIdColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new ConnectionIdColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new ConnectionIdColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new ConnectionIdColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new ConnectionIdColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var TimestampBuilder = class extends TypeBuilder {
	constructor() {
		super(Timestamp.getAlgebraicType());
	}
	index(algorithm = "btree") {
		return new TimestampColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new TimestampColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new TimestampColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new TimestampColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new TimestampColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new TimestampColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var TimeDurationBuilder = class extends TypeBuilder {
	constructor() {
		super(TimeDuration.getAlgebraicType());
	}
	index(algorithm = "btree") {
		return new TimeDurationColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new TimeDurationColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new TimeDurationColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new TimeDurationColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new TimeDurationColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new TimeDurationColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var UuidBuilder = class extends TypeBuilder {
	constructor() {
		super(Uuid.getAlgebraicType());
	}
	index(algorithm = "btree") {
		return new UuidColumnBuilder(this, set(defaultMetadata, { indexType: algorithm }));
	}
	unique() {
		return new UuidColumnBuilder(this, set(defaultMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new UuidColumnBuilder(this, set(defaultMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new UuidColumnBuilder(this, set(defaultMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new UuidColumnBuilder(this, set(defaultMetadata, { defaultValue: value }));
	}
	name(name) {
		return new UuidColumnBuilder(this, set(defaultMetadata, { name }));
	}
};
var defaultMetadata = {};
var ColumnBuilder = class {
	typeBuilder;
	columnMetadata;
	constructor(typeBuilder, metadata) {
		this.typeBuilder = typeBuilder;
		this.columnMetadata = metadata;
	}
	serialize(writer, value) {
		this.typeBuilder.serialize(writer, value);
	}
	deserialize(reader) {
		return this.typeBuilder.deserialize(reader);
	}
};
var U8ColumnBuilder = class _U8ColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _U8ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _U8ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _U8ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new _U8ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new _U8ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _U8ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var U16ColumnBuilder = class _U16ColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _U16ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _U16ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _U16ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new _U16ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new _U16ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _U16ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var U32ColumnBuilder = class _U32ColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _U32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _U32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _U32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new _U32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new _U32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _U32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var U64ColumnBuilder = class _U64ColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _U64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _U64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _U64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new _U64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new _U64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _U64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var U128ColumnBuilder = class _U128ColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _U128ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _U128ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _U128ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new _U128ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new _U128ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _U128ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var U256ColumnBuilder = class _U256ColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _U256ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _U256ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _U256ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new _U256ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new _U256ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _U256ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var I8ColumnBuilder = class _I8ColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _I8ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _I8ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _I8ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new _I8ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new _I8ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _I8ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var I16ColumnBuilder = class _I16ColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _I16ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _I16ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _I16ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new _I16ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new _I16ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _I16ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var I32ColumnBuilder = class _I32ColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _I32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _I32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _I32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new _I32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new _I32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _I32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var I64ColumnBuilder = class _I64ColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _I64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _I64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _I64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new _I64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new _I64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _I64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var I128ColumnBuilder = class _I128ColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _I128ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _I128ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _I128ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new _I128ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new _I128ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _I128ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var I256ColumnBuilder = class _I256ColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _I256ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _I256ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _I256ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	autoInc() {
		return new _I256ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isAutoIncrement: true }));
	}
	default(value) {
		return new _I256ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _I256ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var F32ColumnBuilder = class _F32ColumnBuilder extends ColumnBuilder {
	default(value) {
		return new _F32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _F32ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var F64ColumnBuilder = class _F64ColumnBuilder extends ColumnBuilder {
	default(value) {
		return new _F64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _F64ColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var BoolColumnBuilder = class _BoolColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _BoolColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _BoolColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _BoolColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	default(value) {
		return new _BoolColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _BoolColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var StringColumnBuilder = class _StringColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _StringColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _StringColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _StringColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	default(value) {
		return new _StringColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _StringColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var ArrayColumnBuilder = class _ArrayColumnBuilder extends ColumnBuilder {
	default(value) {
		return new _ArrayColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _ArrayColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var ByteArrayColumnBuilder = class _ByteArrayColumnBuilder extends ColumnBuilder {
	constructor(metadata) {
		super(new TypeBuilder(AlgebraicType.Array(AlgebraicType.U8)), metadata);
	}
	default(value) {
		return new _ByteArrayColumnBuilder(set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _ByteArrayColumnBuilder(set(this.columnMetadata, { name }));
	}
};
var OptionColumnBuilder = class _OptionColumnBuilder extends ColumnBuilder {
	default(value) {
		return new _OptionColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _OptionColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var ResultColumnBuilder = class _ResultColumnBuilder extends ColumnBuilder {
	constructor(typeBuilder, metadata) {
		super(typeBuilder, metadata);
	}
	default(value) {
		return new _ResultColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
};
var ProductColumnBuilder = class _ProductColumnBuilder extends ColumnBuilder {
	default(value) {
		return new _ProductColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _ProductColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var SumColumnBuilder = class _SumColumnBuilder extends ColumnBuilder {
	default(value) {
		return new _SumColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _SumColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
	index(algorithm = "btree") {
		return new _SumColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	primaryKey() {
		return new _SumColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
};
var SimpleSumColumnBuilder = class _SimpleSumColumnBuilder extends SumColumnBuilder {
	index(algorithm = "btree") {
		return new _SimpleSumColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	primaryKey() {
		return new _SimpleSumColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
};
var ScheduleAtColumnBuilder = class _ScheduleAtColumnBuilder extends ColumnBuilder {
	default(value) {
		return new _ScheduleAtColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _ScheduleAtColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var IdentityColumnBuilder = class _IdentityColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _IdentityColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _IdentityColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _IdentityColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	default(value) {
		return new _IdentityColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _IdentityColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var ConnectionIdColumnBuilder = class _ConnectionIdColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _ConnectionIdColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _ConnectionIdColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _ConnectionIdColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	default(value) {
		return new _ConnectionIdColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _ConnectionIdColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var TimestampColumnBuilder = class _TimestampColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _TimestampColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _TimestampColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _TimestampColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	default(value) {
		return new _TimestampColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _TimestampColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var TimeDurationColumnBuilder = class _TimeDurationColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _TimeDurationColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _TimeDurationColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _TimeDurationColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	default(value) {
		return new _TimeDurationColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _TimeDurationColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var UuidColumnBuilder = class _UuidColumnBuilder extends ColumnBuilder {
	index(algorithm = "btree") {
		return new _UuidColumnBuilder(this.typeBuilder, set(this.columnMetadata, { indexType: algorithm }));
	}
	unique() {
		return new _UuidColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isUnique: true }));
	}
	primaryKey() {
		return new _UuidColumnBuilder(this.typeBuilder, set(this.columnMetadata, { isPrimaryKey: true }));
	}
	default(value) {
		return new _UuidColumnBuilder(this.typeBuilder, set(this.columnMetadata, { defaultValue: value }));
	}
	name(name) {
		return new _UuidColumnBuilder(this.typeBuilder, set(this.columnMetadata, { name }));
	}
};
var RefBuilder = class extends TypeBuilder {
	ref;
	/** The phantom type of the pointee of this ref. */
	__spacetimeType;
	constructor(ref) {
		super(AlgebraicType.Ref(ref));
		this.ref = ref;
	}
};
var enumImpl = ((nameOrObj, maybeObj) => {
	let obj = nameOrObj;
	let name = void 0;
	if (typeof nameOrObj === "string") {
		if (!maybeObj) throw new TypeError("When providing a name, you must also provide the variants object or array.");
		obj = maybeObj;
		name = nameOrObj;
	}
	if (Array.isArray(obj)) {
		const simpleVariantsObj = {};
		for (const variant of obj) simpleVariantsObj[variant] = new UnitBuilder();
		return new SimpleSumBuilderImpl(simpleVariantsObj, name);
	}
	return new SumBuilder(obj, name);
});
var t = {
	bool: () => new BoolBuilder(),
	string: () => new StringBuilder(),
	number: () => new F64Builder(),
	i8: () => new I8Builder(),
	u8: () => new U8Builder(),
	i16: () => new I16Builder(),
	u16: () => new U16Builder(),
	i32: () => new I32Builder(),
	u32: () => new U32Builder(),
	i64: () => new I64Builder(),
	u64: () => new U64Builder(),
	i128: () => new I128Builder(),
	u128: () => new U128Builder(),
	i256: () => new I256Builder(),
	u256: () => new U256Builder(),
	f32: () => new F32Builder(),
	f64: () => new F64Builder(),
	object: ((nameOrObj, maybeObj) => {
		if (typeof nameOrObj === "string") {
			if (!maybeObj) throw new TypeError("When providing a name, you must also provide the object.");
			return new ProductBuilder(maybeObj, nameOrObj);
		}
		return new ProductBuilder(nameOrObj, void 0);
	}),
	row: ((nameOrObj, maybeObj) => {
		const [obj, name] = typeof nameOrObj === "string" ? [maybeObj, nameOrObj] : [nameOrObj, void 0];
		return new RowBuilder(obj, name);
	}),
	array(e) {
		return new ArrayBuilder(e);
	},
	enum: enumImpl,
	unit() {
		return new UnitBuilder();
	},
	lazy(thunk) {
		let cached = null;
		const get = () => cached ??= thunk();
		return new Proxy({}, {
			get(_t, prop, recv) {
				const target = get();
				const val = Reflect.get(target, prop, recv);
				return typeof val === "function" ? val.bind(target) : val;
			},
			set(_t, prop, value, recv) {
				return Reflect.set(get(), prop, value, recv);
			},
			has(_t, prop) {
				return prop in get();
			},
			ownKeys() {
				return Reflect.ownKeys(get());
			},
			getOwnPropertyDescriptor(_t, prop) {
				return Object.getOwnPropertyDescriptor(get(), prop);
			},
			getPrototypeOf() {
				return Object.getPrototypeOf(get());
			}
		});
	},
	scheduleAt: () => {
		return new ScheduleAtBuilder();
	},
	option(value) {
		return new OptionBuilder(value);
	},
	result(ok, err) {
		return new ResultBuilder(ok, err);
	},
	identity: () => {
		return new IdentityBuilder();
	},
	connectionId: () => {
		return new ConnectionIdBuilder();
	},
	timestamp: () => {
		return new TimestampBuilder();
	},
	timeDuration: () => {
		return new TimeDurationBuilder();
	},
	uuid: () => {
		return new UuidBuilder();
	},
	byteArray: () => {
		return new ByteArrayBuilder();
	}
};
var AlgebraicType2 = t.enum("AlgebraicType", {
	Ref: t.u32(),
	get Sum() {
		return SumType2;
	},
	get Product() {
		return ProductType2;
	},
	get Array() {
		return AlgebraicType2;
	},
	String: t.unit(),
	Bool: t.unit(),
	I8: t.unit(),
	U8: t.unit(),
	I16: t.unit(),
	U16: t.unit(),
	I32: t.unit(),
	U32: t.unit(),
	I64: t.unit(),
	U64: t.unit(),
	I128: t.unit(),
	U128: t.unit(),
	I256: t.unit(),
	U256: t.unit(),
	F32: t.unit(),
	F64: t.unit()
});
var CaseConversionPolicy = t.enum("CaseConversionPolicy", {
	None: t.unit(),
	SnakeCase: t.unit()
});
var ExplicitNameEntry = t.enum("ExplicitNameEntry", {
	get Table() {
		return NameMapping;
	},
	get Function() {
		return NameMapping;
	},
	get Index() {
		return NameMapping;
	}
});
var ExplicitNames = t.object("ExplicitNames", { get entries() {
	return t.array(ExplicitNameEntry);
} });
var FunctionVisibility = t.enum("FunctionVisibility", {
	Private: t.unit(),
	ClientCallable: t.unit()
});
var HttpHeaderPair = t.object("HttpHeaderPair", {
	name: t.string(),
	value: t.byteArray()
});
var HttpHeaders = t.object("HttpHeaders", { get entries() {
	return t.array(HttpHeaderPair);
} });
var HttpMethod = t.enum("HttpMethod", {
	Get: t.unit(),
	Head: t.unit(),
	Post: t.unit(),
	Put: t.unit(),
	Delete: t.unit(),
	Connect: t.unit(),
	Options: t.unit(),
	Trace: t.unit(),
	Patch: t.unit(),
	Extension: t.string()
});
var HttpRequest = t.object("HttpRequest", {
	get method() {
		return HttpMethod;
	},
	get headers() {
		return HttpHeaders;
	},
	timeout: t.option(t.timeDuration()),
	uri: t.string(),
	get version() {
		return HttpVersion;
	}
});
var HttpResponse = t.object("HttpResponse", {
	get headers() {
		return HttpHeaders;
	},
	get version() {
		return HttpVersion;
	},
	code: t.u16()
});
var HttpVersion = t.enum("HttpVersion", {
	Http09: t.unit(),
	Http10: t.unit(),
	Http11: t.unit(),
	Http2: t.unit(),
	Http3: t.unit()
});
var IndexType = t.enum("IndexType", {
	BTree: t.unit(),
	Hash: t.unit()
});
var Lifecycle = t.enum("Lifecycle", {
	Init: t.unit(),
	OnConnect: t.unit(),
	OnDisconnect: t.unit()
});
var MethodOrAny = t.enum("MethodOrAny", {
	Any: t.unit(),
	get Method() {
		return HttpMethod;
	}
});
var MiscModuleExport = t.enum("MiscModuleExport", { get TypeAlias() {
	return TypeAlias;
} });
var NameMapping = t.object("NameMapping", {
	sourceName: t.string(),
	canonicalName: t.string()
});
var ProductType2 = t.object("ProductType", { get elements() {
	return t.array(ProductTypeElement);
} });
var ProductTypeElement = t.object("ProductTypeElement", {
	name: t.option(t.string()),
	get algebraicType() {
		return AlgebraicType2;
	}
});
var RawColumnDefV8 = t.object("RawColumnDefV8", {
	colName: t.string(),
	get colType() {
		return AlgebraicType2;
	}
});
var RawColumnDefaultValueV10 = t.object("RawColumnDefaultValueV10", {
	colId: t.u16(),
	value: t.byteArray()
});
var RawColumnDefaultValueV9 = t.object("RawColumnDefaultValueV9", {
	table: t.string(),
	colId: t.u16(),
	value: t.byteArray()
});
var RawConstraintDataV9 = t.enum("RawConstraintDataV9", { get Unique() {
	return RawUniqueConstraintDataV9;
} });
var RawConstraintDefV10 = t.object("RawConstraintDefV10", {
	sourceName: t.option(t.string()),
	get data() {
		return RawConstraintDataV9;
	}
});
var RawConstraintDefV8 = t.object("RawConstraintDefV8", {
	constraintName: t.string(),
	constraints: t.u8(),
	columns: t.array(t.u16())
});
var RawConstraintDefV9 = t.object("RawConstraintDefV9", {
	name: t.option(t.string()),
	get data() {
		return RawConstraintDataV9;
	}
});
var RawHttpHandlerDefV10 = t.object("RawHttpHandlerDefV10", { sourceName: t.string() });
var RawHttpRouteDefV10 = t.object("RawHttpRouteDefV10", {
	handlerFunction: t.string(),
	get method() {
		return MethodOrAny;
	},
	path: t.string()
});
var RawIndexAlgorithm = t.enum("RawIndexAlgorithm", {
	BTree: t.array(t.u16()),
	Hash: t.array(t.u16()),
	Direct: t.u16()
});
var RawIndexDefV10 = t.object("RawIndexDefV10", {
	sourceName: t.option(t.string()),
	accessorName: t.option(t.string()),
	get algorithm() {
		return RawIndexAlgorithm;
	}
});
var RawIndexDefV8 = t.object("RawIndexDefV8", {
	indexName: t.string(),
	isUnique: t.bool(),
	get indexType() {
		return IndexType;
	},
	columns: t.array(t.u16())
});
var RawIndexDefV9 = t.object("RawIndexDefV9", {
	name: t.option(t.string()),
	accessorName: t.option(t.string()),
	get algorithm() {
		return RawIndexAlgorithm;
	}
});
var RawLifeCycleReducerDefV10 = t.object("RawLifeCycleReducerDefV10", {
	get lifecycleSpec() {
		return Lifecycle;
	},
	functionName: t.string()
});
var RawMiscModuleExportV9 = t.enum("RawMiscModuleExportV9", {
	get ColumnDefaultValue() {
		return RawColumnDefaultValueV9;
	},
	get Procedure() {
		return RawProcedureDefV9;
	},
	get View() {
		return RawViewDefV9;
	}
});
var RawModuleDef = t.enum("RawModuleDef", {
	get V8BackCompat() {
		return RawModuleDefV8;
	},
	get V9() {
		return RawModuleDefV9;
	},
	get V10() {
		return RawModuleDefV10;
	}
});
var RawModuleDefV10 = t.object("RawModuleDefV10", { get sections() {
	return t.array(RawModuleDefV10Section);
} });
var RawModuleDefV10Section = t.enum("RawModuleDefV10Section", {
	get Typespace() {
		return Typespace;
	},
	get Types() {
		return t.array(RawTypeDefV10);
	},
	get Tables() {
		return t.array(RawTableDefV10);
	},
	get Reducers() {
		return t.array(RawReducerDefV10);
	},
	get Procedures() {
		return t.array(RawProcedureDefV10);
	},
	get Views() {
		return t.array(RawViewDefV10);
	},
	get Schedules() {
		return t.array(RawScheduleDefV10);
	},
	get LifeCycleReducers() {
		return t.array(RawLifeCycleReducerDefV10);
	},
	get RowLevelSecurity() {
		return t.array(RawRowLevelSecurityDefV9);
	},
	get CaseConversionPolicy() {
		return CaseConversionPolicy;
	},
	get ExplicitNames() {
		return ExplicitNames;
	},
	get HttpHandlers() {
		return t.array(RawHttpHandlerDefV10);
	},
	get HttpRoutes() {
		return t.array(RawHttpRouteDefV10);
	},
	get ViewPrimaryKeys() {
		return t.array(RawViewPrimaryKeyDefV10);
	}
});
var RawModuleDefV8 = t.object("RawModuleDefV8", {
	get typespace() {
		return Typespace;
	},
	get tables() {
		return t.array(TableDesc);
	},
	get reducers() {
		return t.array(ReducerDef);
	},
	get miscExports() {
		return t.array(MiscModuleExport);
	}
});
var RawModuleDefV9 = t.object("RawModuleDefV9", {
	get typespace() {
		return Typespace;
	},
	get tables() {
		return t.array(RawTableDefV9);
	},
	get reducers() {
		return t.array(RawReducerDefV9);
	},
	get types() {
		return t.array(RawTypeDefV9);
	},
	get miscExports() {
		return t.array(RawMiscModuleExportV9);
	},
	get rowLevelSecurity() {
		return t.array(RawRowLevelSecurityDefV9);
	}
});
var RawProcedureDefV10 = t.object("RawProcedureDefV10", {
	sourceName: t.string(),
	get params() {
		return ProductType2;
	},
	get returnType() {
		return AlgebraicType2;
	},
	get visibility() {
		return FunctionVisibility;
	}
});
var RawProcedureDefV9 = t.object("RawProcedureDefV9", {
	name: t.string(),
	get params() {
		return ProductType2;
	},
	get returnType() {
		return AlgebraicType2;
	}
});
var RawReducerDefV10 = t.object("RawReducerDefV10", {
	sourceName: t.string(),
	get params() {
		return ProductType2;
	},
	get visibility() {
		return FunctionVisibility;
	},
	get okReturnType() {
		return AlgebraicType2;
	},
	get errReturnType() {
		return AlgebraicType2;
	}
});
var RawReducerDefV9 = t.object("RawReducerDefV9", {
	name: t.string(),
	get params() {
		return ProductType2;
	},
	get lifecycle() {
		return t.option(Lifecycle);
	}
});
var RawRowLevelSecurityDefV9 = t.object("RawRowLevelSecurityDefV9", { sql: t.string() });
var RawScheduleDefV10 = t.object("RawScheduleDefV10", {
	sourceName: t.option(t.string()),
	tableName: t.string(),
	scheduleAtCol: t.u16(),
	functionName: t.string()
});
var RawScheduleDefV9 = t.object("RawScheduleDefV9", {
	name: t.option(t.string()),
	reducerName: t.string(),
	scheduledAtColumn: t.u16()
});
var RawScopedTypeNameV10 = t.object("RawScopedTypeNameV10", {
	scope: t.array(t.string()),
	sourceName: t.string()
});
var RawScopedTypeNameV9 = t.object("RawScopedTypeNameV9", {
	scope: t.array(t.string()),
	name: t.string()
});
var RawSequenceDefV10 = t.object("RawSequenceDefV10", {
	sourceName: t.option(t.string()),
	column: t.u16(),
	start: t.option(t.i128()),
	minValue: t.option(t.i128()),
	maxValue: t.option(t.i128()),
	increment: t.i128()
});
var RawSequenceDefV8 = t.object("RawSequenceDefV8", {
	sequenceName: t.string(),
	colPos: t.u16(),
	increment: t.i128(),
	start: t.option(t.i128()),
	minValue: t.option(t.i128()),
	maxValue: t.option(t.i128()),
	allocated: t.i128()
});
var RawSequenceDefV9 = t.object("RawSequenceDefV9", {
	name: t.option(t.string()),
	column: t.u16(),
	start: t.option(t.i128()),
	minValue: t.option(t.i128()),
	maxValue: t.option(t.i128()),
	increment: t.i128()
});
var RawTableDefV10 = t.object("RawTableDefV10", {
	sourceName: t.string(),
	productTypeRef: t.u32(),
	primaryKey: t.array(t.u16()),
	get indexes() {
		return t.array(RawIndexDefV10);
	},
	get constraints() {
		return t.array(RawConstraintDefV10);
	},
	get sequences() {
		return t.array(RawSequenceDefV10);
	},
	get tableType() {
		return TableType;
	},
	get tableAccess() {
		return TableAccess;
	},
	get defaultValues() {
		return t.array(RawColumnDefaultValueV10);
	},
	isEvent: t.bool()
});
var RawTableDefV8 = t.object("RawTableDefV8", {
	tableName: t.string(),
	get columns() {
		return t.array(RawColumnDefV8);
	},
	get indexes() {
		return t.array(RawIndexDefV8);
	},
	get constraints() {
		return t.array(RawConstraintDefV8);
	},
	get sequences() {
		return t.array(RawSequenceDefV8);
	},
	tableType: t.string(),
	tableAccess: t.string(),
	scheduled: t.option(t.string())
});
var RawTableDefV9 = t.object("RawTableDefV9", {
	name: t.string(),
	productTypeRef: t.u32(),
	primaryKey: t.array(t.u16()),
	get indexes() {
		return t.array(RawIndexDefV9);
	},
	get constraints() {
		return t.array(RawConstraintDefV9);
	},
	get sequences() {
		return t.array(RawSequenceDefV9);
	},
	get schedule() {
		return t.option(RawScheduleDefV9);
	},
	get tableType() {
		return TableType;
	},
	get tableAccess() {
		return TableAccess;
	}
});
var RawTypeDefV10 = t.object("RawTypeDefV10", {
	get sourceName() {
		return RawScopedTypeNameV10;
	},
	ty: t.u32(),
	customOrdering: t.bool()
});
var RawTypeDefV9 = t.object("RawTypeDefV9", {
	get name() {
		return RawScopedTypeNameV9;
	},
	ty: t.u32(),
	customOrdering: t.bool()
});
var RawUniqueConstraintDataV9 = t.object("RawUniqueConstraintDataV9", { columns: t.array(t.u16()) });
var RawViewDefV10 = t.object("RawViewDefV10", {
	sourceName: t.string(),
	index: t.u32(),
	isPublic: t.bool(),
	isAnonymous: t.bool(),
	get params() {
		return ProductType2;
	},
	get returnType() {
		return AlgebraicType2;
	}
});
var RawViewDefV9 = t.object("RawViewDefV9", {
	name: t.string(),
	index: t.u32(),
	isPublic: t.bool(),
	isAnonymous: t.bool(),
	get params() {
		return ProductType2;
	},
	get returnType() {
		return AlgebraicType2;
	}
});
var RawViewPrimaryKeyDefV10 = t.object("RawViewPrimaryKeyDefV10", {
	viewSourceName: t.string(),
	columns: t.array(t.string())
});
var ReducerDef = t.object("ReducerDef", {
	name: t.string(),
	get args() {
		return t.array(ProductTypeElement);
	}
});
var SumType2 = t.object("SumType", { get variants() {
	return t.array(SumTypeVariant);
} });
var SumTypeVariant = t.object("SumTypeVariant", {
	name: t.option(t.string()),
	get algebraicType() {
		return AlgebraicType2;
	}
});
var TableAccess = t.enum("TableAccess", {
	Public: t.unit(),
	Private: t.unit()
});
var TableDesc = t.object("TableDesc", {
	get schema() {
		return RawTableDefV8;
	},
	data: t.u32()
});
var TableType = t.enum("TableType", {
	System: t.unit(),
	User: t.unit()
});
var TypeAlias = t.object("TypeAlias", {
	name: t.string(),
	ty: t.u32()
});
var Typespace = t.object("Typespace", { get types() {
	return t.array(AlgebraicType2);
} });
var ViewResultHeader = t.enum("ViewResultHeader", {
	RowData: t.unit(),
	RawSql: t.string()
});
function tableToSchema(accName, schema2, tableDef) {
	const getColName = (i) => schema2.rowType.algebraicType.value.elements[i].name;
	const resolvedIndexes = tableDef.indexes.map((idx) => {
		const accessorName = idx.accessorName;
		if (typeof accessorName !== "string" || accessorName.length === 0) throw new TypeError(`Index '${idx.sourceName ?? "<unknown>"}' on table '${tableDef.sourceName}' is missing accessor name`);
		const columnIds = idx.algorithm.tag === "Direct" ? [idx.algorithm.value] : idx.algorithm.value;
		return {
			name: accessorName,
			unique: tableDef.constraints.some((c) => c.data.tag === "Unique" && c.data.value.columns.every((col) => columnIds.includes(col))),
			algorithm: {
				BTree: "btree",
				Hash: "hash",
				Direct: "direct"
			}[idx.algorithm.tag],
			columns: columnIds.map(getColName)
		};
	});
	return {
		sourceName: schema2.tableName || accName,
		accessorName: accName,
		columns: schema2.rowType.row,
		rowType: schema2.rowSpacetimeType,
		indexes: schema2.idxs,
		constraints: tableDef.constraints.map((c) => ({
			name: c.sourceName,
			constraint: "unique",
			columns: c.data.value.columns.map(getColName)
		})),
		resolvedIndexes,
		tableDef,
		...tableDef.isEvent ? { isEvent: true } : {}
	};
}
var ModuleContext = class {
	#compoundTypes = /* @__PURE__ */ new Map();
	/**
	* The global module definition that gets populated by calls to `reducer()` and lifecycle hooks.
	*/
	#moduleDef = {
		typespace: { types: [] },
		tables: [],
		reducers: [],
		types: [],
		rowLevelSecurity: [],
		schedules: [],
		procedures: [],
		views: [],
		viewPrimaryKeys: [],
		lifeCycleReducers: [],
		httpHandlers: [],
		httpRoutes: [],
		caseConversionPolicy: { tag: "SnakeCase" },
		explicitNames: { entries: [] }
	};
	get moduleDef() {
		return this.#moduleDef;
	}
	rawModuleDefV10() {
		const sections = [];
		const push = (s) => {
			if (s) sections.push(s);
		};
		const module = this.#moduleDef;
		push(module.typespace && {
			tag: "Typespace",
			value: module.typespace
		});
		push(module.types && {
			tag: "Types",
			value: module.types
		});
		push(module.tables && {
			tag: "Tables",
			value: module.tables
		});
		push(module.reducers && {
			tag: "Reducers",
			value: module.reducers
		});
		push(module.procedures && {
			tag: "Procedures",
			value: module.procedures
		});
		push(module.views && {
			tag: "Views",
			value: module.views
		});
		push(module.viewPrimaryKeys && {
			tag: "ViewPrimaryKeys",
			value: module.viewPrimaryKeys
		});
		push(module.schedules && {
			tag: "Schedules",
			value: module.schedules
		});
		push(module.lifeCycleReducers && {
			tag: "LifeCycleReducers",
			value: module.lifeCycleReducers
		});
		push(module.httpHandlers && {
			tag: "HttpHandlers",
			value: module.httpHandlers
		});
		push(module.httpRoutes && {
			tag: "HttpRoutes",
			value: module.httpRoutes
		});
		push(module.rowLevelSecurity && {
			tag: "RowLevelSecurity",
			value: module.rowLevelSecurity
		});
		push(module.explicitNames && {
			tag: "ExplicitNames",
			value: module.explicitNames
		});
		push(module.caseConversionPolicy && {
			tag: "CaseConversionPolicy",
			value: module.caseConversionPolicy
		});
		return { sections };
	}
	/**
	* Set the case conversion policy for this module.
	* Called by the settings mechanism.
	*/
	setCaseConversionPolicy(policy) {
		this.#moduleDef.caseConversionPolicy = policy;
	}
	get typespace() {
		return this.#moduleDef.typespace;
	}
	/**
	* Resolves the actual type of a TypeBuilder by following its references until it reaches a non-ref type.
	* @param typespace The typespace to resolve types against.
	* @param typeBuilder The TypeBuilder to resolve.
	* @returns The resolved algebraic type.
	*/
	resolveType(typeBuilder) {
		let ty = typeBuilder.algebraicType;
		while (ty.tag === "Ref") ty = this.typespace.types[ty.value];
		return ty;
	}
	/**
	* Adds a type to the module definition's typespace as a `Ref` if it is a named compound type (Product or Sum).
	* Otherwise, returns the type as is.
	* @param name
	* @param ty
	* @returns
	*/
	registerTypesRecursively(typeBuilder) {
		if (typeBuilder instanceof ProductBuilder && !isUnit(typeBuilder) || typeBuilder instanceof SumBuilder || typeBuilder instanceof RowBuilder) return this.#registerCompoundTypeRecursively(typeBuilder);
		else if (typeBuilder instanceof OptionBuilder) return new OptionBuilder(this.registerTypesRecursively(typeBuilder.value));
		else if (typeBuilder instanceof ResultBuilder) return new ResultBuilder(this.registerTypesRecursively(typeBuilder.ok), this.registerTypesRecursively(typeBuilder.err));
		else if (typeBuilder instanceof ArrayBuilder) return new ArrayBuilder(this.registerTypesRecursively(typeBuilder.element));
		else return typeBuilder;
	}
	#registerCompoundTypeRecursively(typeBuilder) {
		const ty = typeBuilder.algebraicType;
		const name = typeBuilder.typeName;
		if (name === void 0) throw new Error(`Missing type name for ${typeBuilder.constructor.name ?? "TypeBuilder"} ${JSON.stringify(typeBuilder)}`);
		let r = this.#compoundTypes.get(ty);
		if (r != null) return r;
		const newTy = typeBuilder instanceof RowBuilder || typeBuilder instanceof ProductBuilder ? {
			tag: "Product",
			value: { elements: [] }
		} : {
			tag: "Sum",
			value: { variants: [] }
		};
		r = new RefBuilder(this.#moduleDef.typespace.types.length);
		this.#moduleDef.typespace.types.push(newTy);
		this.#compoundTypes.set(ty, r);
		if (typeBuilder instanceof RowBuilder) for (const [name2, elem] of Object.entries(typeBuilder.row)) newTy.value.elements.push({
			name: name2,
			algebraicType: this.registerTypesRecursively(elem.typeBuilder).algebraicType
		});
		else if (typeBuilder instanceof ProductBuilder) for (const [name2, elem] of Object.entries(typeBuilder.elements)) newTy.value.elements.push({
			name: name2,
			algebraicType: this.registerTypesRecursively(elem).algebraicType
		});
		else if (typeBuilder instanceof SumBuilder) for (const [name2, variant] of Object.entries(typeBuilder.variants)) newTy.value.variants.push({
			name: name2,
			algebraicType: this.registerTypesRecursively(variant).algebraicType
		});
		this.#moduleDef.types.push({
			sourceName: splitName(name),
			ty: r.ref,
			customOrdering: true
		});
		return r;
	}
};
function isUnit(typeBuilder) {
	return typeBuilder.typeName == null && typeBuilder.algebraicType.value.elements.length === 0;
}
function splitName(name) {
	const scope = name.split(".");
	return {
		sourceName: scope.pop(),
		scope
	};
}
var textEncoder = new TextEncoder();
var textDecoder = new TextDecoder("utf-8");
function deserializeMethod(method) {
	switch (method.tag) {
		case "Get": return "GET";
		case "Head": return "HEAD";
		case "Post": return "POST";
		case "Put": return "PUT";
		case "Delete": return "DELETE";
		case "Connect": return "CONNECT";
		case "Options": return "OPTIONS";
		case "Trace": return "TRACE";
		case "Patch": return "PATCH";
		case "Extension": return method.value;
	}
}
var methods = /* @__PURE__ */ new Map([
	["GET", { tag: "Get" }],
	["HEAD", { tag: "Head" }],
	["POST", { tag: "Post" }],
	["PUT", { tag: "Put" }],
	["DELETE", { tag: "Delete" }],
	["CONNECT", { tag: "Connect" }],
	["OPTIONS", { tag: "Options" }],
	["TRACE", { tag: "Trace" }],
	["PATCH", { tag: "Patch" }]
]);
function serializeMethod(method) {
	return methods.get(method?.toUpperCase() ?? "GET") ?? {
		tag: "Extension",
		value: method
	};
}
function serializeHeaders(headers) {
	return { entries: headersToList(headers).flatMap(([k, v]) => Array.isArray(v) ? v.map((v2) => [k, v2]) : [[k, v]]).map(([name, value]) => ({
		name,
		value: textEncoder.encode(value)
	})) };
}
function deserializeHeaders(headers) {
	return new Headers(headers.entries.map(({ name, value }) => [name, textDecoder.decode(value)]));
}
var makeResponse = Symbol("makeResponse");
var SyncResponse = class _SyncResponse {
	#body;
	#inner;
	constructor(body, init) {
		if (body == null) this.#body = null;
		else if (typeof body === "string") this.#body = body;
		else this.#body = new Uint8Array(body).buffer;
		this.#inner = {
			headers: new Headers(init?.headers),
			status: init?.status ?? 200,
			statusText: init?.statusText ?? "",
			type: "default",
			url: null,
			aborted: false,
			version: init?.version ?? { tag: "Http11" }
		};
	}
	static [makeResponse](body, inner) {
		const me = new _SyncResponse(body);
		me.#inner = inner;
		return me;
	}
	get headers() {
		return this.#inner.headers;
	}
	get status() {
		return this.#inner.status;
	}
	get statusText() {
		return this.#inner.statusText;
	}
	get ok() {
		return 200 <= this.#inner.status && this.#inner.status <= 299;
	}
	get url() {
		return this.#inner.url ?? "";
	}
	get type() {
		return this.#inner.type;
	}
	get version() {
		return this.#inner.version;
	}
	arrayBuffer() {
		return this.bytes().buffer;
	}
	bytes() {
		if (this.#body == null) return new Uint8Array();
		else if (typeof this.#body === "string") return textEncoder.encode(this.#body);
		else return new Uint8Array(this.#body);
	}
	json() {
		return JSON.parse(this.text());
	}
	text() {
		if (this.#body == null) return "";
		else if (typeof this.#body === "string") return this.#body;
		else return textDecoder.decode(this.#body);
	}
};
var httpHandlerFn = Symbol("SpacetimeDB.httpHandlerFn");
var makeRequest = Symbol("makeRequest");
function coerceRequestBody(body) {
	if (body == null) return null;
	if (typeof body === "string") return body;
	return new Uint8Array(body);
}
function requestBodyToBytes(body) {
	if (body == null) return new Uint8Array();
	if (typeof body === "string") return textEncoder.encode(body);
	return body;
}
function requestBodyToText(body) {
	if (body == null) return "";
	if (typeof body === "string") return body;
	return textDecoder.decode(body);
}
var Request = class _Request {
	#body;
	#inner;
	constructor(url, init = {}) {
		this.#body = coerceRequestBody(init.body);
		this.#inner = {
			headers: new Headers(init.headers),
			method: init.method ?? "GET",
			uri: "" + url,
			version: init.version ?? { tag: "Http11" }
		};
	}
	static [makeRequest](body, inner) {
		const me = new _Request(inner.uri);
		me.#body = coerceRequestBody(body);
		me.#inner = inner;
		return me;
	}
	get headers() {
		return this.#inner.headers;
	}
	get method() {
		return this.#inner.method;
	}
	get uri() {
		return this.#inner.uri;
	}
	get url() {
		return this.#inner.uri;
	}
	get version() {
		return this.#inner.version;
	}
	arrayBuffer() {
		return this.bytes().buffer;
	}
	bytes() {
		return requestBodyToBytes(this.#body);
	}
	json() {
		return JSON.parse(this.text());
	}
	text() {
		return requestBodyToText(this.#body);
	}
};
var exportedHttpHandlerObjects = /* @__PURE__ */ new WeakSet();
function makeHttpHandlerExport(ctx, opts, fn) {
	const handlerExport = {
		[httpHandlerFn]: fn,
		[exportContext]: ctx,
		[registerExport](ctx2, exportName) {
			if (exportedHttpHandlerObjects.has(handlerExport)) throw new TypeError(`HTTP handler '${exportName}' was exported more than once`);
			exportedHttpHandlerObjects.add(handlerExport);
			registerHttpHandler(ctx2, exportName, fn, opts);
			ctx2.httpHandlerExports.set(handlerExport, exportName);
		}
	};
	return handlerExport;
}
function makeHttpRouterExport(ctx, router) {
	return {
		[exportContext]: ctx,
		[registerExport](ctx2) {
			ctx2.pendingHttpRoutes.push(...router.intoRoutes());
		}
	};
}
function registerHttpHandler(ctx, exportName, fn, opts) {
	ctx.defineHttpHandler(exportName);
	ctx.moduleDef.httpHandlers.push({ sourceName: exportName });
	if (opts?.name != null) ctx.moduleDef.explicitNames.entries.push({
		tag: "Function",
		value: {
			sourceName: exportName,
			canonicalName: opts.name
		}
	});
	if (!fn.name) Object.defineProperty(fn, "name", {
		value: exportName,
		writable: false
	});
	ctx.httpHandlers.push(fn);
}
var import_statuses = __toESM(require_statuses());
var Range = class {
	#from;
	#to;
	constructor(from, to) {
		this.#from = from ?? { tag: "unbounded" };
		this.#to = to ?? { tag: "unbounded" };
	}
	get from() {
		return this.#from;
	}
	get to() {
		return this.#to;
	}
};
function table(opts, row, ..._) {
	const { name, public: isPublic = false, indexes: userIndexes = [], scheduled, event: isEvent = false } = opts;
	const colIds = /* @__PURE__ */ new Map();
	const colNameList = [];
	if (!(row instanceof RowBuilder)) row = new RowBuilder(row);
	row.algebraicType.value.elements.forEach((elem, i) => {
		colIds.set(elem.name, i);
		colNameList.push(elem.name);
	});
	const pk = [];
	const indexes = [];
	const constraints = [];
	const sequences = [];
	let scheduleAtCol;
	const defaultValues = [];
	for (const [name2, builder] of Object.entries(row.row)) {
		const meta = builder.columnMetadata;
		if (meta.isPrimaryKey) pk.push(colIds.get(name2));
		const isUnique = meta.isUnique || meta.isPrimaryKey;
		if (meta.indexType || isUnique) {
			const algo = meta.indexType ?? "btree";
			const id = colIds.get(name2);
			let algorithm;
			switch (algo) {
				case "btree":
					algorithm = RawIndexAlgorithm.BTree([id]);
					break;
				case "hash":
					algorithm = RawIndexAlgorithm.Hash([id]);
					break;
				case "direct":
					algorithm = RawIndexAlgorithm.Direct(id);
					break;
			}
			indexes.push({
				sourceName: void 0,
				accessorName: name2,
				algorithm
			});
		}
		if (isUnique) constraints.push({
			sourceName: void 0,
			data: {
				tag: "Unique",
				value: { columns: [colIds.get(name2)] }
			}
		});
		if (meta.isAutoIncrement) sequences.push({
			sourceName: void 0,
			start: void 0,
			minValue: void 0,
			maxValue: void 0,
			column: colIds.get(name2),
			increment: 1n
		});
		if (Object.prototype.hasOwnProperty.call(meta, "defaultValue")) {
			const writer = new BinaryWriter(16);
			builder.serialize(writer, meta.defaultValue);
			defaultValues.push({
				colId: colIds.get(name2),
				value: writer.getBuffer()
			});
		}
		const algebraicType = builder.typeBuilder.algebraicType;
		if (schedule_at_default.isScheduleAt(algebraicType)) scheduleAtCol = colIds.get(name2);
	}
	for (const indexOpts of userIndexes ?? []) {
		const accessor = indexOpts.accessor;
		if (typeof accessor !== "string" || accessor.length === 0) {
			const tableLabel = name ?? "<unnamed>";
			const indexLabel = indexOpts.name ?? "<unnamed>";
			throw new TypeError(`Index '${indexLabel}' on table '${tableLabel}' must define a non-empty 'accessor'`);
		}
		let algorithm;
		switch (indexOpts.algorithm) {
			case "btree":
				algorithm = {
					tag: "BTree",
					value: indexOpts.columns.map((c) => colIds.get(c))
				};
				break;
			case "hash":
				algorithm = {
					tag: "Hash",
					value: indexOpts.columns.map((c) => colIds.get(c))
				};
				break;
			case "direct":
				algorithm = {
					tag: "Direct",
					value: colIds.get(indexOpts.column)
				};
				break;
		}
		indexes.push({
			sourceName: void 0,
			accessorName: accessor,
			algorithm,
			canonicalName: indexOpts.name
		});
	}
	for (const constraintOpts of opts.constraints ?? []) if (constraintOpts.constraint === "unique") {
		const data = {
			tag: "Unique",
			value: { columns: constraintOpts.columns.map((c) => colIds.get(c)) }
		};
		constraints.push({
			sourceName: constraintOpts.name,
			data
		});
		continue;
	}
	const productType = row.algebraicType.value;
	return {
		rowType: row,
		tableName: name,
		rowSpacetimeType: productType,
		tableDef: (ctx, accName) => {
			const tableName = name ?? accName;
			if (row.typeName === void 0) row.typeName = toPascalCase(tableName);
			for (const index of indexes) {
				const sourceName = index.sourceName = `${accName}_${(index.algorithm.tag === "Direct" ? [index.algorithm.value] : index.algorithm.value).map((i) => colNameList[i]).join("_")}_idx_${index.algorithm.tag.toLowerCase()}`;
				const { canonicalName } = index;
				if (canonicalName !== void 0) ctx.moduleDef.explicitNames.entries.push(ExplicitNameEntry.Index({
					sourceName,
					canonicalName
				}));
			}
			return {
				sourceName: accName,
				productTypeRef: ctx.registerTypesRecursively(row).ref,
				primaryKey: pk,
				indexes,
				constraints,
				sequences,
				tableType: { tag: "User" },
				tableAccess: { tag: isPublic ? "Public" : "Private" },
				defaultValues,
				isEvent
			};
		},
		idxs: userIndexes,
		constraints,
		scheduleAtCol,
		schedule: scheduled && scheduleAtCol !== void 0 ? {
			scheduleAtCol,
			reducer: scheduled
		} : void 0
	};
}
var QueryBrand = Symbol("QueryBrand");
var isRowTypedQuery = (val) => !!val && typeof val === "object" && QueryBrand in val;
function toSql(q) {
	return q.toSql();
}
var SemijoinImpl = class _SemijoinImpl {
	constructor(sourceQuery, filterQuery, joinCondition) {
		this.sourceQuery = sourceQuery;
		this.filterQuery = filterQuery;
		this.joinCondition = joinCondition;
		if (sourceQuery.table.sourceName === filterQuery.table.sourceName) throw new Error("Cannot semijoin a table to itself");
	}
	[QueryBrand] = true;
	type = "semijoin";
	build() {
		return this;
	}
	where(predicate) {
		return new _SemijoinImpl(this.sourceQuery.where(predicate), this.filterQuery, this.joinCondition);
	}
	toSql() {
		const left = this.filterQuery;
		const right = this.sourceQuery;
		const leftTable = quoteIdentifier(left.table.sourceName);
		const rightTable = quoteIdentifier(right.table.sourceName);
		let sql = `SELECT ${rightTable}.* FROM ${leftTable} JOIN ${rightTable} ON ${booleanExprToSql(this.joinCondition)}`;
		const clauses = [];
		if (left.whereClause) clauses.push(booleanExprToSql(left.whereClause));
		if (right.whereClause) clauses.push(booleanExprToSql(right.whereClause));
		if (clauses.length > 0) {
			const whereSql = clauses.length === 1 ? clauses[0] : clauses.map(wrapInParens).join(" AND ");
			sql += ` WHERE ${whereSql}`;
		}
		return sql;
	}
};
var FromBuilder = class _FromBuilder {
	constructor(table2, whereClause) {
		this.table = table2;
		this.whereClause = whereClause;
	}
	[QueryBrand] = true;
	where(predicate) {
		const newCondition = normalizePredicateExpr(predicate(this.table.cols));
		const nextWhere = this.whereClause ? this.whereClause.and(newCondition) : newCondition;
		return new _FromBuilder(this.table, nextWhere);
	}
	rightSemijoin(right, on) {
		const sourceQuery = new _FromBuilder(right);
		const joinCondition = on(this.table.indexedCols, right.indexedCols);
		return new SemijoinImpl(sourceQuery, this, joinCondition);
	}
	leftSemijoin(right, on) {
		const filterQuery = new _FromBuilder(right);
		const joinCondition = on(this.table.indexedCols, right.indexedCols);
		return new SemijoinImpl(this, filterQuery, joinCondition);
	}
	toSql() {
		return renderSelectSqlWithJoins(this.table, this.whereClause);
	}
	build() {
		return this;
	}
};
var TableRefImpl = class {
	[QueryBrand] = true;
	type = "table";
	sourceName;
	accessorName;
	cols;
	indexedCols;
	tableDef;
	get columns() {
		return this.tableDef.columns;
	}
	get indexes() {
		return this.tableDef.indexes;
	}
	get rowType() {
		return this.tableDef.rowType;
	}
	get constraints() {
		return this.tableDef.constraints;
	}
	constructor(tableDef) {
		this.sourceName = tableDef.sourceName;
		this.accessorName = tableDef.accessorName;
		this.cols = createRowExpr(tableDef);
		this.indexedCols = this.cols;
		this.tableDef = tableDef;
		Object.freeze(this);
	}
	asFrom() {
		return new FromBuilder(this);
	}
	rightSemijoin(other, on) {
		return this.asFrom().rightSemijoin(other, on);
	}
	leftSemijoin(other, on) {
		return this.asFrom().leftSemijoin(other, on);
	}
	build() {
		return this.asFrom().build();
	}
	toSql() {
		return this.asFrom().toSql();
	}
	where(predicate) {
		return this.asFrom().where(predicate);
	}
};
function createTableRefFromDef(tableDef) {
	return new TableRefImpl(tableDef);
}
function makeQueryBuilder(schema2) {
	const qb = /* @__PURE__ */ Object.create(null);
	for (const table2 of Object.values(schema2.tables)) {
		const ref = createTableRefFromDef(table2);
		qb[table2.accessorName] = ref;
	}
	return Object.freeze(qb);
}
function createRowExpr(tableDef) {
	const row = {};
	for (const columnName of Object.keys(tableDef.columns)) {
		const columnBuilder = tableDef.columns[columnName];
		const column = new ColumnExpression(tableDef.sourceName, columnName, columnBuilder.typeBuilder.algebraicType, columnBuilder.columnMetadata.name);
		row[columnName] = Object.freeze(column);
	}
	return Object.freeze(row);
}
function renderSelectSqlWithJoins(table2, where, extraClauses = []) {
	const sql = `SELECT * FROM ${quoteIdentifier(table2.sourceName)}`;
	const clauses = [];
	if (where) clauses.push(booleanExprToSql(where));
	clauses.push(...extraClauses);
	if (clauses.length === 0) return sql;
	return `${sql} WHERE ${clauses.length === 1 ? clauses[0] : clauses.map(wrapInParens).join(" AND ")}`;
}
var ColumnExpression = class {
	type = "column";
	column;
	columnName;
	table;
	tsValueType;
	spacetimeType;
	constructor(table2, column, spacetimeType, columnName) {
		this.table = table2;
		this.column = column;
		this.columnName = columnName || column;
		this.spacetimeType = spacetimeType;
	}
	eq(x) {
		return new BooleanExpr({
			type: "eq",
			left: this,
			right: normalizeValue(x)
		});
	}
	ne(x) {
		return new BooleanExpr({
			type: "ne",
			left: this,
			right: normalizeValue(x)
		});
	}
	lt(x) {
		return new BooleanExpr({
			type: "lt",
			left: this,
			right: normalizeValue(x)
		});
	}
	lte(x) {
		return new BooleanExpr({
			type: "lte",
			left: this,
			right: normalizeValue(x)
		});
	}
	gt(x) {
		return new BooleanExpr({
			type: "gt",
			left: this,
			right: normalizeValue(x)
		});
	}
	gte(x) {
		return new BooleanExpr({
			type: "gte",
			left: this,
			right: normalizeValue(x)
		});
	}
};
function literal(value) {
	return {
		type: "literal",
		value
	};
}
function normalizeValue(val) {
	if (val.type === "literal") return val;
	if (typeof val === "object" && val != null && "type" in val && val.type === "column") return val;
	return literal(val);
}
function normalizePredicateExpr(value) {
	if (value instanceof BooleanExpr) return value;
	if (typeof value === "boolean") return new BooleanExpr({
		type: "eq",
		left: literal(value),
		right: literal(true)
	});
	return new BooleanExpr({
		type: "eq",
		left: value,
		right: literal(true)
	});
}
var BooleanExpr = class _BooleanExpr {
	constructor(data) {
		this.data = data;
	}
	and(other) {
		return new _BooleanExpr({
			type: "and",
			clauses: [this.data, other.data]
		});
	}
	or(other) {
		return new _BooleanExpr({
			type: "or",
			clauses: [this.data, other.data]
		});
	}
	not() {
		return new _BooleanExpr({
			type: "not",
			clause: this.data
		});
	}
};
function booleanExprToSql(expr, tableAlias) {
	const data = expr instanceof BooleanExpr ? expr.data : expr;
	switch (data.type) {
		case "eq": return `${valueExprToSql(data.left)} = ${valueExprToSql(data.right)}`;
		case "ne": return `${valueExprToSql(data.left)} <> ${valueExprToSql(data.right)}`;
		case "gt": return `${valueExprToSql(data.left)} > ${valueExprToSql(data.right)}`;
		case "gte": return `${valueExprToSql(data.left)} >= ${valueExprToSql(data.right)}`;
		case "lt": return `${valueExprToSql(data.left)} < ${valueExprToSql(data.right)}`;
		case "lte": return `${valueExprToSql(data.left)} <= ${valueExprToSql(data.right)}`;
		case "and": return data.clauses.map((c) => booleanExprToSql(c)).map(wrapInParens).join(" AND ");
		case "or": return data.clauses.map((c) => booleanExprToSql(c)).map(wrapInParens).join(" OR ");
		case "not": return `NOT ${wrapInParens(booleanExprToSql(data.clause))}`;
	}
}
function wrapInParens(sql) {
	return `(${sql})`;
}
function valueExprToSql(expr, tableAlias) {
	if (isLiteralExpr(expr)) return literalValueToSql(expr.value);
	const table2 = expr.table;
	return `${quoteIdentifier(table2)}.${quoteIdentifier(expr.columnName)}`;
}
function literalValueToSql(value) {
	if (value === null || value === void 0) return "NULL";
	if (value instanceof Identity || value instanceof ConnectionId || value instanceof Uuid) return `0x${value.toHexString()}`;
	if (value instanceof Timestamp) return `'${value.toISOString()}'`;
	switch (typeof value) {
		case "number":
		case "bigint": return String(value);
		case "boolean": return value ? "TRUE" : "FALSE";
		case "string": return `'${value.replace(/'/g, "''")}'`;
		default: return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
	}
}
function quoteIdentifier(name) {
	return `"${name.replace(/"/g, "\"\"")}"`;
}
function isLiteralExpr(expr) {
	return expr.type === "literal";
}
function makeViewExport(ctx, opts, params, ret, fn) {
	const viewExport = fn.bind();
	viewExport[exportContext] = ctx;
	viewExport[registerExport] = (ctx2, exportName) => {
		registerView(ctx2, opts, exportName, false, params, ret, fn);
	};
	return viewExport;
}
function makeAnonViewExport(ctx, opts, params, ret, fn) {
	const viewExport = fn.bind();
	viewExport[exportContext] = ctx;
	viewExport[registerExport] = (ctx2, exportName) => {
		registerView(ctx2, opts, exportName, true, params, ret, fn);
	};
	return viewExport;
}
function registerView(ctx, opts, exportName, anon, params, ret, fn) {
	ctx.defineFunction(exportName);
	const paramsBuilder = new RowBuilder(params, toPascalCase(exportName));
	let returnType = ctx.registerTypesRecursively(ret).algebraicType;
	const { typespace } = ctx;
	const { value: paramType } = ctx.resolveType(ctx.registerTypesRecursively(paramsBuilder));
	ctx.moduleDef.views.push({
		sourceName: exportName,
		index: (anon ? ctx.anonViews : ctx.views).length,
		isPublic: opts.public,
		isAnonymous: anon,
		params: paramType,
		returnType
	});
	const primaryKeyColumns = viewPrimaryKeyColumns(ret);
	if (primaryKeyColumns.length > 1) throw new TypeError(`View '${exportName}' can have at most one primaryKey() column on its returned row type; found ${primaryKeyColumns.join(", ")}`);
	if (primaryKeyColumns.length === 1) ctx.moduleDef.viewPrimaryKeys.push({
		viewSourceName: exportName,
		columns: primaryKeyColumns
	});
	if (opts.name != null) ctx.moduleDef.explicitNames.entries.push({
		tag: "Function",
		value: {
			sourceName: exportName,
			canonicalName: opts.name
		}
	});
	if (returnType.tag == "Sum") {
		const originalFn = fn;
		fn = ((ctx2, args) => {
			const ret2 = originalFn(ctx2, args);
			return ret2 == null ? [] : [ret2];
		});
		returnType = AlgebraicType.Array(returnType.value.variants[0].algebraicType);
	}
	(anon ? ctx.anonViews : ctx.views).push({
		fn,
		deserializeParams: ProductType.makeDeserializer(paramType, typespace),
		serializeReturn: AlgebraicType.makeSerializer(returnType, typespace),
		returnTypeBaseSize: bsatnBaseSize(typespace, returnType)
	});
}
function viewPrimaryKeyColumns(ret) {
	const row = viewReturnRow(ret);
	if (row == null) return [];
	return Object.entries(row.row).filter((entry) => entry[1].columnMetadata.isPrimaryKey === true).map(([name]) => name);
}
function viewReturnRow(ret) {
	if (ret instanceof ArrayBuilder && ret.element instanceof RowBuilder) return ret.element;
	if (ret instanceof OptionBuilder && ret.value instanceof RowBuilder) return ret.value;
}
var SenderError = class extends Error {
	constructor(message) {
		super(message);
	}
	get name() {
		return "SenderError";
	}
};
var SpacetimeHostError = class extends Error {
	constructor(message) {
		super(message);
	}
	get name() {
		return "SpacetimeHostError";
	}
};
var errorData = {
	HostCallFailure: 1,
	NotInTransaction: 2,
	BsatnDecodeError: 3,
	NoSuchTable: 4,
	NoSuchIndex: 5,
	NoSuchIter: 6,
	NoSuchConsoleTimer: 7,
	NoSuchBytes: 8,
	NoSpace: 9,
	BufferTooSmall: 11,
	UniqueAlreadyExists: 12,
	ScheduleAtDelayTooLong: 13,
	IndexNotUnique: 14,
	NoSuchRow: 15,
	AutoIncOverflow: 16,
	WouldBlockTransaction: 17,
	TransactionNotAnonymous: 18,
	TransactionIsReadOnly: 19,
	TransactionIsMut: 20,
	HttpError: 21
};
function mapEntries(x, f) {
	return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, f(k, v)]));
}
var errnoToClass = /* @__PURE__ */ new Map();
var errors = Object.freeze(mapEntries(errorData, (name, code) => {
	const cls = Object.defineProperty(class extends SpacetimeHostError {
		get name() {
			return name;
		}
	}, "name", {
		value: name,
		writable: false
	});
	errnoToClass.set(code, cls);
	return cls;
}));
function getErrorConstructor(code) {
	return errnoToClass.get(code) ?? SpacetimeHostError;
}
var SBigInt = typeof BigInt !== "undefined" ? BigInt : void 0;
var One = typeof BigInt !== "undefined" ? BigInt(1) : void 0;
var ThirtyTwo = typeof BigInt !== "undefined" ? BigInt(32) : void 0;
var NumValues = typeof BigInt !== "undefined" ? BigInt(4294967296) : void 0;
function unsafeUniformBigIntDistribution(from, to, rng) {
	var diff = to - from + One;
	var FinalNumValues = NumValues;
	var NumIterations = 1;
	while (FinalNumValues < diff) {
		FinalNumValues <<= ThirtyTwo;
		++NumIterations;
	}
	var value = generateNext(NumIterations, rng);
	if (value < diff) return value + from;
	if (value + diff < FinalNumValues) return value % diff + from;
	var MaxAcceptedRandom = FinalNumValues - FinalNumValues % diff;
	while (value >= MaxAcceptedRandom) value = generateNext(NumIterations, rng);
	return value % diff + from;
}
function generateNext(NumIterations, rng) {
	var value = SBigInt(rng.unsafeNext() + 2147483648);
	for (var num = 1; num < NumIterations; ++num) {
		var out = rng.unsafeNext();
		value = (value << ThirtyTwo) + SBigInt(out + 2147483648);
	}
	return value;
}
function unsafeUniformIntDistributionInternal(rangeSize, rng) {
	var MaxAllowed = rangeSize > 2 ? ~~(4294967296 / rangeSize) * rangeSize : 4294967296;
	var deltaV = rng.unsafeNext() + 2147483648;
	while (deltaV >= MaxAllowed) deltaV = rng.unsafeNext() + 2147483648;
	return deltaV % rangeSize;
}
function fromNumberToArrayInt64(out, n) {
	if (n < 0) {
		var posN = -n;
		out.sign = -1;
		out.data[0] = ~~(posN / 4294967296);
		out.data[1] = posN >>> 0;
	} else {
		out.sign = 1;
		out.data[0] = ~~(n / 4294967296);
		out.data[1] = n >>> 0;
	}
	return out;
}
function substractArrayInt64(out, arrayIntA, arrayIntB) {
	var lowA = arrayIntA.data[1];
	var highA = arrayIntA.data[0];
	var signA = arrayIntA.sign;
	var lowB = arrayIntB.data[1];
	var highB = arrayIntB.data[0];
	var signB = arrayIntB.sign;
	out.sign = 1;
	if (signA === 1 && signB === -1) {
		var low_1 = lowA + lowB;
		var high = highA + highB + (low_1 > 4294967295 ? 1 : 0);
		out.data[0] = high >>> 0;
		out.data[1] = low_1 >>> 0;
		return out;
	}
	var lowFirst = lowA;
	var highFirst = highA;
	var lowSecond = lowB;
	var highSecond = highB;
	if (signA === -1) {
		lowFirst = lowB;
		highFirst = highB;
		lowSecond = lowA;
		highSecond = highA;
	}
	var reminderLow = 0;
	var low = lowFirst - lowSecond;
	if (low < 0) {
		reminderLow = 1;
		low = low >>> 0;
	}
	out.data[0] = highFirst - highSecond - reminderLow;
	out.data[1] = low;
	return out;
}
function unsafeUniformArrayIntDistributionInternal(out, rangeSize, rng) {
	var rangeLength = rangeSize.length;
	while (true) {
		for (var index = 0; index !== rangeLength; ++index) out[index] = unsafeUniformIntDistributionInternal(index === 0 ? rangeSize[0] + 1 : 4294967296, rng);
		for (var index = 0; index !== rangeLength; ++index) {
			var current = out[index];
			var currentInRange = rangeSize[index];
			if (current < currentInRange) return out;
			else if (current > currentInRange) break;
		}
	}
}
var safeNumberMaxSafeInteger = Number.MAX_SAFE_INTEGER;
var sharedA = {
	sign: 1,
	data: [0, 0]
};
var sharedB = {
	sign: 1,
	data: [0, 0]
};
var sharedC = {
	sign: 1,
	data: [0, 0]
};
var sharedData = [0, 0];
function uniformLargeIntInternal(from, to, rangeSize, rng) {
	var rangeSizeArrayIntValue = rangeSize <= safeNumberMaxSafeInteger ? fromNumberToArrayInt64(sharedC, rangeSize) : substractArrayInt64(sharedC, fromNumberToArrayInt64(sharedA, to), fromNumberToArrayInt64(sharedB, from));
	if (rangeSizeArrayIntValue.data[1] === 4294967295) {
		rangeSizeArrayIntValue.data[0] += 1;
		rangeSizeArrayIntValue.data[1] = 0;
	} else rangeSizeArrayIntValue.data[1] += 1;
	unsafeUniformArrayIntDistributionInternal(sharedData, rangeSizeArrayIntValue.data, rng);
	return sharedData[0] * 4294967296 + sharedData[1] + from;
}
function unsafeUniformIntDistribution(from, to, rng) {
	var rangeSize = to - from;
	if (rangeSize <= 4294967295) return unsafeUniformIntDistributionInternal(rangeSize + 1, rng) + from;
	return uniformLargeIntInternal(from, to, rangeSize, rng);
}
var XoroShiro128Plus = (function() {
	function XoroShiro128Plus2(s01, s00, s11, s10) {
		this.s01 = s01;
		this.s00 = s00;
		this.s11 = s11;
		this.s10 = s10;
	}
	XoroShiro128Plus2.prototype.clone = function() {
		return new XoroShiro128Plus2(this.s01, this.s00, this.s11, this.s10);
	};
	XoroShiro128Plus2.prototype.next = function() {
		var nextRng = new XoroShiro128Plus2(this.s01, this.s00, this.s11, this.s10);
		return [nextRng.unsafeNext(), nextRng];
	};
	XoroShiro128Plus2.prototype.unsafeNext = function() {
		var out = this.s00 + this.s10 | 0;
		var a0 = this.s10 ^ this.s00;
		var a1 = this.s11 ^ this.s01;
		var s00 = this.s00;
		var s01 = this.s01;
		this.s00 = s00 << 24 ^ s01 >>> 8 ^ a0 ^ a0 << 16;
		this.s01 = s01 << 24 ^ s00 >>> 8 ^ a1 ^ (a1 << 16 | a0 >>> 16);
		this.s10 = a1 << 5 ^ a0 >>> 27;
		this.s11 = a0 << 5 ^ a1 >>> 27;
		return out;
	};
	XoroShiro128Plus2.prototype.jump = function() {
		var nextRng = new XoroShiro128Plus2(this.s01, this.s00, this.s11, this.s10);
		nextRng.unsafeJump();
		return nextRng;
	};
	XoroShiro128Plus2.prototype.unsafeJump = function() {
		var ns01 = 0;
		var ns00 = 0;
		var ns11 = 0;
		var ns10 = 0;
		var jump = [
			3639956645,
			3750757012,
			1261568508,
			386426335
		];
		for (var i = 0; i !== 4; ++i) for (var mask = 1; mask; mask <<= 1) {
			if (jump[i] & mask) {
				ns01 ^= this.s01;
				ns00 ^= this.s00;
				ns11 ^= this.s11;
				ns10 ^= this.s10;
			}
			this.unsafeNext();
		}
		this.s01 = ns01;
		this.s00 = ns00;
		this.s11 = ns11;
		this.s10 = ns10;
	};
	XoroShiro128Plus2.prototype.getState = function() {
		return [
			this.s01,
			this.s00,
			this.s11,
			this.s10
		];
	};
	return XoroShiro128Plus2;
})();
function fromState(state) {
	if (!(state.length === 4)) throw new Error("The state must have been produced by a xoroshiro128plus RandomGenerator");
	return new XoroShiro128Plus(state[0], state[1], state[2], state[3]);
}
var xoroshiro128plus = Object.assign(function(seed) {
	return new XoroShiro128Plus(-1, ~seed, seed | 0, 0);
}, { fromState });
var { asUintN } = BigInt;
function pcg32(state) {
	state = asUintN(64, state * 6364136223846793005n + 11634580027462260723n);
	const xorshifted = Number(asUintN(32, (state >> 18n ^ state) >> 27n));
	const rot = Number(asUintN(32, state >> 59n));
	return xorshifted >> rot | xorshifted << 32 - rot;
}
function generateFloat64(rng) {
	const g1 = unsafeUniformIntDistribution(0, (1 << 26) - 1, rng);
	const g2 = unsafeUniformIntDistribution(0, (1 << 27) - 1, rng);
	return (g1 * Math.pow(2, 27) + g2) * Math.pow(2, -53);
}
function makeRandom(seed) {
	const rng = xoroshiro128plus(pcg32(seed.microsSinceUnixEpoch));
	const random = () => generateFloat64(rng);
	random.fill = (array) => {
		if (isBigIntArray(array)) {
			const upper = (1n << BigInt(array.BYTES_PER_ELEMENT * 8)) - 1n;
			for (let i = 0; i < array.length; i++) array[i] = unsafeUniformBigIntDistribution(0n, upper, rng);
		} else {
			const upper = Math.pow(2, array.BYTES_PER_ELEMENT * 8) - 1;
			for (let i = 0; i < array.length; i++) array[i] = unsafeUniformIntDistribution(0, upper, rng);
		}
		return array;
	};
	random.uint32 = () => rng.unsafeNext();
	random.integerInRange = (min, max) => unsafeUniformIntDistribution(min, max, rng);
	random.bigintInRange = (min, max) => unsafeUniformBigIntDistribution(min, max, rng);
	return random;
}
function isBigIntArray(array) {
	return array instanceof BigInt64Array || array instanceof BigUint64Array;
}
var { freeze } = Object;
var sys = {
	..._syscalls2_0,
	..._syscalls2_1
};
function requestFromWire(request, body) {
	return Request[makeRequest](body, {
		headers: deserializeHeaders(request.headers),
		method: deserializeMethod(request.method),
		uri: request.uri,
		version: request.version
	});
}
function responseIntoWire(response) {
	return [{
		headers: serializeHeaders(response.headers),
		version: response.version,
		code: response.status
	}, response.bytes()];
}
function parseJsonObject(json) {
	let value;
	try {
		value = JSON.parse(json);
	} catch {
		throw new Error("Invalid JSON: failed to parse string");
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object at the top level");
	return value;
}
var JwtClaimsImpl = class {
	/**
	* Creates a new JwtClaims instance.
	* @param rawPayload The JWT payload as a raw JSON string.
	* @param identity The identity for this JWT. We are only taking this because we don't have a blake3 implementation (which we need to compute it).
	*/
	constructor(rawPayload, identity) {
		this.rawPayload = rawPayload;
		this.fullPayload = parseJsonObject(rawPayload);
		this._identity = identity;
	}
	fullPayload;
	_identity;
	get identity() {
		return this._identity;
	}
	get subject() {
		return this.fullPayload["sub"];
	}
	get issuer() {
		return this.fullPayload["iss"];
	}
	get audience() {
		const aud = this.fullPayload["aud"];
		if (aud == null) return [];
		return typeof aud === "string" ? [aud] : aud;
	}
};
var AuthCtxImpl = class _AuthCtxImpl {
	isInternal;
	_jwtSource;
	_initializedJWT = false;
	_jwtClaims;
	_senderIdentity;
	constructor(opts) {
		this.isInternal = opts.isInternal;
		this._jwtSource = opts.jwtSource;
		this._senderIdentity = opts.senderIdentity;
	}
	_initializeJWT() {
		if (this._initializedJWT) return;
		this._initializedJWT = true;
		const token = this._jwtSource();
		if (!token) this._jwtClaims = null;
		else this._jwtClaims = new JwtClaimsImpl(token, this._senderIdentity);
		Object.freeze(this);
	}
	/** Lazily compute whether a JWT exists and is parseable. */
	get hasJWT() {
		this._initializeJWT();
		return this._jwtClaims !== null;
	}
	/** Lazily parse the JwtClaims only when accessed. */
	get jwt() {
		this._initializeJWT();
		return this._jwtClaims;
	}
	/** Create a context representing internal (non-user) requests. */
	static internal() {
		return new _AuthCtxImpl({
			isInternal: true,
			jwtSource: () => null,
			senderIdentity: Identity.zero()
		});
	}
	/** If there is a connection id, look up the JWT payload from the system tables. */
	static fromSystemTables(connectionId, sender) {
		if (connectionId === null) return new _AuthCtxImpl({
			isInternal: false,
			jwtSource: () => null,
			senderIdentity: sender
		});
		return new _AuthCtxImpl({
			isInternal: false,
			jwtSource: () => {
				const payloadBuf = sys.get_jwt_payload(connectionId.__connection_id__);
				if (payloadBuf.length === 0) return null;
				return new TextDecoder().decode(payloadBuf);
			},
			senderIdentity: sender
		});
	}
};
var ReducerCtxImpl = class ReducerCtx {
	#identity;
	#senderAuth;
	#uuidCounter;
	#random;
	sender;
	timestamp;
	connectionId;
	db;
	constructor(sender, timestamp, connectionId, dbView) {
		Object.seal(this);
		this.sender = sender;
		this.timestamp = timestamp;
		this.connectionId = connectionId;
		this.db = dbView;
	}
	/** Reset the `ReducerCtx` to be used for a new transaction */
	static reset(me, sender, timestamp, connectionId) {
		me.sender = sender;
		me.timestamp = timestamp;
		me.connectionId = connectionId;
		me.#uuidCounter = void 0;
		me.#senderAuth = void 0;
	}
	get databaseIdentity() {
		return this.#identity ??= new Identity(sys.identity());
	}
	get identity() {
		return this.databaseIdentity;
	}
	get senderAuth() {
		return this.#senderAuth ??= AuthCtxImpl.fromSystemTables(this.connectionId, this.sender);
	}
	get random() {
		return this.#random ??= makeRandom(this.timestamp);
	}
	/**
	* Create a new random {@link Uuid} `v4` using this `ReducerCtx`'s RNG.
	*/
	newUuidV4() {
		const bytes = this.random.fill(new Uint8Array(16));
		return Uuid.fromRandomBytesV4(bytes);
	}
	/**
	* Create a new sortable {@link Uuid} `v7` using this `ReducerCtx`'s RNG, counter,
	* and timestamp.
	*/
	newUuidV7() {
		const bytes = this.random.fill(new Uint8Array(4));
		const counter = this.#uuidCounter ??= { value: 0 };
		return Uuid.fromCounterV7(counter, this.timestamp, bytes);
	}
};
var callUserFunction = function __spacetimedb_end_short_backtrace(fn, ...args) {
	return fn(...args);
};
function runWithTx(makeCtx, body) {
	const run = () => {
		const timestamp = sys.procedure_start_mut_tx();
		try {
			return body(makeCtx(new Timestamp(timestamp)));
		} catch (e) {
			sys.procedure_abort_mut_tx();
			throw e;
		}
	};
	let res = run();
	try {
		sys.procedure_commit_mut_tx();
		return res;
	} catch {}
	console.warn("committing anonymous transaction failed");
	res = run();
	try {
		sys.procedure_commit_mut_tx();
		return res;
	} catch (e) {
		throw new Error("transaction retry failed again", { cause: e });
	}
}
var makeHooks = (schema2) => new ModuleHooksImpl(schema2);
var ModuleHooksImpl = class {
	#schema;
	#dbView_;
	#reducerArgsDeserializers;
	/** Cache the `ReducerCtx` object to avoid allocating anew for ever reducer call. */
	#reducerCtx_;
	constructor(schema2) {
		this.#schema = schema2;
		this.#reducerArgsDeserializers = schema2.moduleDef.reducers.map(({ params }) => ProductType.makeDeserializer(params, schema2.typespace));
	}
	get #dbView() {
		return this.#dbView_ ??= freeze(Object.fromEntries(Object.values(this.#schema.schemaType.tables).map((table2) => [table2.accessorName, makeTableView(this.#schema.typespace, table2.tableDef)])));
	}
	get #reducerCtx() {
		return this.#reducerCtx_ ??= new ReducerCtxImpl(Identity.zero(), Timestamp.UNIX_EPOCH, null, this.#dbView);
	}
	__describe_module__() {
		const writer = new BinaryWriter(128);
		RawModuleDef.serialize(writer, RawModuleDef.V10(this.#schema.rawModuleDefV10()));
		return writer.getBuffer();
	}
	__get_error_constructor__(code) {
		return getErrorConstructor(code);
	}
	get __sender_error_class__() {
		return SenderError;
	}
	__call_reducer__(reducerId, sender, connId, timestamp, argsBuf) {
		const moduleCtx = this.#schema;
		const deserializeArgs = this.#reducerArgsDeserializers[reducerId];
		BINARY_READER.reset(argsBuf);
		const args = deserializeArgs(BINARY_READER);
		const senderIdentity = new Identity(sender);
		const ctx = this.#reducerCtx;
		ReducerCtxImpl.reset(ctx, senderIdentity, new Timestamp(timestamp), ConnectionId.nullIfZero(new ConnectionId(connId)));
		callUserFunction(moduleCtx.reducers[reducerId], ctx, args);
	}
	__call_view__(id, sender, argsBuf) {
		const moduleCtx = this.#schema;
		const { fn, deserializeParams, serializeReturn, returnTypeBaseSize } = moduleCtx.views[id];
		const ret = callUserFunction(fn, freeze({
			sender: new Identity(sender),
			db: this.#dbView,
			from: makeQueryBuilder(moduleCtx.schemaType)
		}), deserializeParams(new BinaryReader(argsBuf)));
		const retBuf = new BinaryWriter(returnTypeBaseSize);
		if (isRowTypedQuery(ret)) {
			const query = toSql(ret);
			ViewResultHeader.serialize(retBuf, ViewResultHeader.RawSql(query));
		} else {
			ViewResultHeader.serialize(retBuf, ViewResultHeader.RowData);
			serializeReturn(retBuf, ret);
		}
		return { data: retBuf.getBuffer() };
	}
	__call_view_anon__(id, argsBuf) {
		const moduleCtx = this.#schema;
		const { fn, deserializeParams, serializeReturn, returnTypeBaseSize } = moduleCtx.anonViews[id];
		const ret = callUserFunction(fn, freeze({
			db: this.#dbView,
			from: makeQueryBuilder(moduleCtx.schemaType)
		}), deserializeParams(new BinaryReader(argsBuf)));
		const retBuf = new BinaryWriter(returnTypeBaseSize);
		if (isRowTypedQuery(ret)) {
			const query = toSql(ret);
			ViewResultHeader.serialize(retBuf, ViewResultHeader.RawSql(query));
		} else {
			ViewResultHeader.serialize(retBuf, ViewResultHeader.RowData);
			serializeReturn(retBuf, ret);
		}
		return { data: retBuf.getBuffer() };
	}
	__call_procedure__(id, sender, connection_id, timestamp, args) {
		return callProcedure(this.#schema, id, new Identity(sender), ConnectionId.nullIfZero(new ConnectionId(connection_id)), new Timestamp(timestamp), args, () => this.#dbView);
	}
	__call_http_handler__(id, timestamp, request, body) {
		const moduleCtx = this.#schema;
		const handler = moduleCtx.httpHandlers[id];
		const [responseMetadata, responseBody] = responseIntoWire(callUserFunction(handler, new HandlerContextImpl(new Timestamp(timestamp), () => this.#dbView), requestFromWire(HttpRequest.deserialize(new BinaryReader(request)), body)));
		const responseBuf = new BinaryWriter(bsatnBaseSize(moduleCtx.typespace, HttpResponse.algebraicType));
		HttpResponse.serialize(responseBuf, responseMetadata);
		return [responseBuf.getBuffer(), responseBody];
	}
};
var BINARY_WRITER = new BinaryWriter(0);
var BINARY_READER = new BinaryReader(new Uint8Array());
var HandlerContextImpl = class {
	constructor(timestamp, dbView) {
		this.timestamp = timestamp;
		this.#dbView = dbView;
	}
	#identity;
	#uuidCounter;
	#random;
	#dbView;
	http = httpClient;
	get identity() {
		return this.#identity ??= new Identity(sys.identity());
	}
	get random() {
		return this.#random ??= makeRandom(this.timestamp);
	}
	withTx(body) {
		return runWithTx((timestamp) => new ReducerCtxImpl(Identity.zero(), timestamp, null, this.#dbView()), body);
	}
	newUuidV4() {
		const bytes = this.random.fill(new Uint8Array(16));
		return Uuid.fromRandomBytesV4(bytes);
	}
	newUuidV7() {
		const bytes = this.random.fill(new Uint8Array(4));
		const counter = this.#uuidCounter ??= { value: 0 };
		return Uuid.fromCounterV7(counter, this.timestamp, bytes);
	}
};
function makeTableView(typespace, table2) {
	const table_id = sys.table_id_from_name(table2.sourceName);
	const rowType = typespace.types[table2.productTypeRef];
	if (rowType.tag !== "Product") throw "impossible";
	const serializeRow = AlgebraicType.makeSerializer(rowType, typespace);
	const deserializeRow = AlgebraicType.makeDeserializer(rowType, typespace);
	const sequences = table2.sequences.map((seq) => {
		const col = rowType.value.elements[seq.column];
		const colType = col.algebraicType;
		let sequenceTrigger;
		switch (colType.tag) {
			case "U8":
			case "I8":
			case "U16":
			case "I16":
			case "U32":
			case "I32":
				sequenceTrigger = 0;
				break;
			case "U64":
			case "I64":
			case "U128":
			case "I128":
			case "U256":
			case "I256":
				sequenceTrigger = 0n;
				break;
			default: throw new TypeError("invalid sequence type");
		}
		return {
			colName: col.name,
			sequenceTrigger,
			deserialize: AlgebraicType.makeDeserializer(colType, typespace)
		};
	});
	const hasAutoIncrement = sequences.length > 0;
	const iter = () => tableIterator(sys.datastore_table_scan_bsatn(table_id), deserializeRow);
	const integrateGeneratedColumns = hasAutoIncrement ? (row, ret_buf) => {
		BINARY_READER.reset(ret_buf);
		for (const { colName, deserialize, sequenceTrigger } of sequences) if (row[colName] === sequenceTrigger) row[colName] = deserialize(BINARY_READER);
	} : null;
	const tableMethods = {
		count: () => sys.datastore_table_row_count(table_id),
		iter,
		[Symbol.iterator]: () => iter(),
		insert: (row) => {
			const buf = LEAF_BUF;
			BINARY_WRITER.reset(buf);
			serializeRow(BINARY_WRITER, row);
			sys.datastore_insert_bsatn(table_id, buf.buffer, BINARY_WRITER.offset);
			const ret = { ...row };
			integrateGeneratedColumns?.(ret, buf.view);
			return ret;
		},
		delete: (row) => {
			const buf = LEAF_BUF;
			BINARY_WRITER.reset(buf);
			BINARY_WRITER.writeU32(1);
			serializeRow(BINARY_WRITER, row);
			return sys.datastore_delete_all_by_eq_bsatn(table_id, buf.buffer, BINARY_WRITER.offset) > 0;
		},
		clear: () => sys.datastore_clear(table_id)
	};
	const tableView = Object.assign(/* @__PURE__ */ Object.create(null), tableMethods);
	for (const indexDef of table2.indexes) {
		const accessorName = indexDef.accessorName;
		const index_id = sys.index_id_from_name(indexDef.sourceName);
		let column_ids;
		let isHashIndex = false;
		switch (indexDef.algorithm.tag) {
			case "Hash":
				isHashIndex = true;
				column_ids = indexDef.algorithm.value;
				break;
			case "BTree":
				column_ids = indexDef.algorithm.value;
				break;
			case "Direct":
				column_ids = [indexDef.algorithm.value];
				break;
		}
		const numColumns = column_ids.length;
		const columnSet = new Set(column_ids);
		const isUnique = table2.constraints.filter((x) => x.data.tag === "Unique").some((x) => columnSet.isSubsetOf(new Set(x.data.value.columns)));
		const isPrimaryKey = isUnique && column_ids.length === table2.primaryKey.length && column_ids.every((id, i) => table2.primaryKey[i] === id);
		const indexSerializers = column_ids.map((id) => AlgebraicType.makeSerializer(rowType.value.elements[id].algebraicType, typespace));
		const serializePoint = (buffer, colVal) => {
			BINARY_WRITER.reset(buffer);
			for (let i = 0; i < numColumns; i++) indexSerializers[i](BINARY_WRITER, colVal[i]);
			return BINARY_WRITER.offset;
		};
		const serializeSingleElement = numColumns === 1 ? indexSerializers[0] : null;
		const serializeSinglePoint = serializeSingleElement && ((buffer, colVal) => {
			BINARY_WRITER.reset(buffer);
			serializeSingleElement(BINARY_WRITER, colVal);
			return BINARY_WRITER.offset;
		});
		let index;
		if (isUnique && serializeSinglePoint) {
			const base = {
				find: (colVal) => {
					const buf = LEAF_BUF;
					const point_len = serializeSinglePoint(buf, colVal);
					return tableIterateOne(sys.datastore_index_scan_point_bsatn(index_id, buf.buffer, point_len), deserializeRow);
				},
				delete: (colVal) => {
					const buf = LEAF_BUF;
					const point_len = serializeSinglePoint(buf, colVal);
					return sys.datastore_delete_by_index_scan_point_bsatn(index_id, buf.buffer, point_len) > 0;
				}
			};
			if (isPrimaryKey) base.update = (row) => {
				const buf = LEAF_BUF;
				BINARY_WRITER.reset(buf);
				serializeRow(BINARY_WRITER, row);
				sys.datastore_update_bsatn(table_id, index_id, buf.buffer, BINARY_WRITER.offset);
				integrateGeneratedColumns?.(row, buf.view);
				return row;
			};
			index = base;
		} else if (isUnique) {
			const base = {
				find: (colVal) => {
					if (colVal.length !== numColumns) throw new TypeError("wrong number of elements");
					const buf = LEAF_BUF;
					const point_len = serializePoint(buf, colVal);
					return tableIterateOne(sys.datastore_index_scan_point_bsatn(index_id, buf.buffer, point_len), deserializeRow);
				},
				delete: (colVal) => {
					if (colVal.length !== numColumns) throw new TypeError("wrong number of elements");
					const buf = LEAF_BUF;
					const point_len = serializePoint(buf, colVal);
					return sys.datastore_delete_by_index_scan_point_bsatn(index_id, buf.buffer, point_len) > 0;
				}
			};
			if (isPrimaryKey) base.update = (row) => {
				const buf = LEAF_BUF;
				BINARY_WRITER.reset(buf);
				serializeRow(BINARY_WRITER, row);
				sys.datastore_update_bsatn(table_id, index_id, buf.buffer, BINARY_WRITER.offset);
				integrateGeneratedColumns?.(row, buf.view);
				return row;
			};
			index = base;
		} else if (serializeSinglePoint) {
			const serializeSingleRange = !isHashIndex ? (buffer, range) => {
				BINARY_WRITER.reset(buffer);
				const writer = BINARY_WRITER;
				const writeBound = (bound) => {
					writer.writeU8({
						included: 0,
						excluded: 1,
						unbounded: 2
					}[bound.tag]);
					if (bound.tag !== "unbounded") serializeSingleElement(writer, bound.value);
				};
				writeBound(range.from);
				const rstartLen = writer.offset;
				writeBound(range.to);
				return [
					0,
					0,
					rstartLen,
					writer.offset - rstartLen
				];
			} : null;
			const rawIndex = {
				filter: (range) => {
					const buf = LEAF_BUF;
					if (serializeSingleRange && range instanceof Range) {
						const args = serializeSingleRange(buf, range);
						return tableIterator(sys.datastore_index_scan_range_bsatn(index_id, buf.buffer, ...args), deserializeRow);
					}
					const point_len = serializeSinglePoint(buf, range);
					return tableIterator(sys.datastore_index_scan_point_bsatn(index_id, buf.buffer, point_len), deserializeRow);
				},
				delete: (range) => {
					const buf = LEAF_BUF;
					if (serializeSingleRange && range instanceof Range) {
						const args = serializeSingleRange(buf, range);
						return sys.datastore_delete_by_index_scan_range_bsatn(index_id, buf.buffer, ...args);
					}
					const point_len = serializeSinglePoint(buf, range);
					return sys.datastore_delete_by_index_scan_point_bsatn(index_id, buf.buffer, point_len);
				}
			};
			if (isHashIndex) index = rawIndex;
			else index = rawIndex;
		} else if (isHashIndex) index = {
			filter: (range) => {
				const buf = LEAF_BUF;
				const point_len = serializePoint(buf, range);
				return tableIterator(sys.datastore_index_scan_point_bsatn(index_id, buf.buffer, point_len), deserializeRow);
			},
			delete: (range) => {
				const buf = LEAF_BUF;
				const point_len = serializePoint(buf, range);
				return sys.datastore_delete_by_index_scan_point_bsatn(index_id, buf.buffer, point_len);
			}
		};
		else {
			const serializeRange = (buffer, range) => {
				if (range.length > numColumns) throw new TypeError("too many elements");
				BINARY_WRITER.reset(buffer);
				const writer = BINARY_WRITER;
				const prefix_elems = range.length - 1;
				for (let i = 0; i < prefix_elems; i++) indexSerializers[i](writer, range[i]);
				const rstartOffset = writer.offset;
				const term = range[range.length - 1];
				const serializeTerm = indexSerializers[range.length - 1];
				if (term instanceof Range) {
					const writeBound = (bound) => {
						writer.writeU8({
							included: 0,
							excluded: 1,
							unbounded: 2
						}[bound.tag]);
						if (bound.tag !== "unbounded") serializeTerm(writer, bound.value);
					};
					writeBound(term.from);
					const rstartLen = writer.offset - rstartOffset;
					writeBound(term.to);
					return [
						rstartOffset,
						prefix_elems,
						rstartLen,
						writer.offset - rstartLen
					];
				} else {
					writer.writeU8(0);
					serializeTerm(writer, term);
					return [
						rstartOffset,
						prefix_elems,
						writer.offset,
						0
					];
				}
			};
			index = {
				filter: (range) => {
					if (!Array.isArray(range)) range = [range];
					if (range.length === numColumns) {
						const buf = LEAF_BUF;
						const point_len = serializePoint(buf, range);
						return tableIterator(sys.datastore_index_scan_point_bsatn(index_id, buf.buffer, point_len), deserializeRow);
					} else {
						const buf = LEAF_BUF;
						const args = serializeRange(buf, range);
						return tableIterator(sys.datastore_index_scan_range_bsatn(index_id, buf.buffer, ...args), deserializeRow);
					}
				},
				delete: (range) => {
					if (!Array.isArray(range)) range = [range];
					if (range.length === numColumns) {
						const buf = LEAF_BUF;
						const point_len = serializePoint(buf, range);
						return sys.datastore_delete_by_index_scan_point_bsatn(index_id, buf.buffer, point_len);
					} else {
						const buf = LEAF_BUF;
						const args = serializeRange(buf, range);
						return sys.datastore_delete_by_index_scan_range_bsatn(index_id, buf.buffer, ...args);
					}
				}
			};
		}
		if (Object.hasOwn(tableView, accessorName)) freeze(Object.assign(tableView[accessorName], index));
		else tableView[accessorName] = freeze(index);
	}
	return freeze(tableView);
}
function* tableIterator(id, deserialize) {
	using iter = new IteratorHandle(id);
	const iterBuf = takeBuf();
	try {
		let amt;
		while (amt = iter.advance(iterBuf)) {
			const reader = new BinaryReader(iterBuf.view);
			while (reader.offset < amt) yield deserialize(reader);
		}
	} finally {
		returnBuf(iterBuf);
	}
}
function tableIterateOne(id, deserialize) {
	const buf = LEAF_BUF;
	if (advanceIterRaw(id, buf) !== 0) {
		BINARY_READER.reset(buf.view);
		return deserialize(BINARY_READER);
	}
	return null;
}
function advanceIterRaw(id, buf) {
	while (true) try {
		return 0 | sys.row_iter_bsatn_advance(id, buf.buffer);
	} catch (e) {
		if (e && typeof e === "object" && hasOwn(e, "__buffer_too_small__")) {
			buf.grow(e.__buffer_too_small__);
			continue;
		}
		throw e;
	}
}
var DEFAULT_BUFFER_CAPACITY = 32 * 1024 * 2;
var ITER_BUFS = [new ResizableBuffer(DEFAULT_BUFFER_CAPACITY)];
var ITER_BUF_COUNT = 1;
function takeBuf() {
	return ITER_BUF_COUNT ? ITER_BUFS[--ITER_BUF_COUNT] : new ResizableBuffer(DEFAULT_BUFFER_CAPACITY);
}
function returnBuf(buf) {
	ITER_BUFS[ITER_BUF_COUNT++] = buf;
}
var LEAF_BUF = new ResizableBuffer(DEFAULT_BUFFER_CAPACITY);
var IteratorHandle = class _IteratorHandle {
	#id;
	static #finalizationRegistry = new FinalizationRegistry(sys.row_iter_bsatn_close);
	constructor(id) {
		this.#id = id;
		_IteratorHandle.#finalizationRegistry.register(this, id, this);
	}
	/** Unregister this object with the finalization registry and return the id */
	#detach() {
		const id = this.#id;
		this.#id = -1;
		_IteratorHandle.#finalizationRegistry.unregister(this);
		return id;
	}
	/** Call `row_iter_bsatn_advance`, returning 0 if this iterator has been exhausted. */
	advance(buf) {
		if (this.#id === -1) return 0;
		const ret = advanceIterRaw(this.#id, buf);
		if (ret <= 0) this.#detach();
		return ret < 0 ? -ret : ret;
	}
	[Symbol.dispose]() {
		if (this.#id >= 0) {
			const id = this.#detach();
			sys.row_iter_bsatn_close(id);
		}
	}
};
var { freeze: freeze2 } = Object;
var requestBaseSize = bsatnBaseSize({ types: [] }, HttpRequest.algebraicType);
function fetch(url, init = {}) {
	const method = serializeMethod(init.method);
	const headers = serializeHeaders(new Headers(init.headers));
	const uri = "" + url;
	const request = freeze2({
		method,
		headers,
		timeout: init.timeout,
		uri,
		version: { tag: "Http11" }
	});
	const requestBuf = new BinaryWriter(requestBaseSize);
	HttpRequest.serialize(requestBuf, request);
	const body = init.body == null ? new Uint8Array() : typeof init.body === "string" ? init.body : new Uint8Array(init.body);
	const [responseBuf, responseBody] = sys.procedure_http_request(requestBuf.getBuffer(), body);
	const response = HttpResponse.deserialize(new BinaryReader(responseBuf));
	return SyncResponse[makeResponse](responseBody, {
		type: "basic",
		url: uri,
		status: response.code,
		statusText: (0, import_statuses.default)(response.code),
		headers: deserializeHeaders(response.headers),
		aborted: false,
		version: response.version
	});
}
freeze2(fetch);
var httpClient = freeze2({ fetch });
function makeProcedureExport(ctx, opts, params, ret, fn) {
	const name = opts?.name;
	const procedureExport = (...args) => fn(...args);
	procedureExport[exportContext] = ctx;
	procedureExport[registerExport] = (ctx2, exportName) => {
		registerProcedure(ctx2, name ?? exportName, params, ret, fn);
		ctx2.functionExports.set(procedureExport, name ?? exportName);
		if (opts?.onSchedule !== void 0) ctx2.pendingSchedules.push({
			table: opts.onSchedule,
			functionName: name ?? exportName
		});
	};
	return procedureExport;
}
var TransactionCtxImpl = class TransactionCtx extends ReducerCtxImpl {};
function registerProcedure(ctx, exportName, params, ret, fn, opts) {
	ctx.defineFunction(exportName);
	const paramsType = { elements: Object.entries(params).map(([n, c]) => ({
		name: n,
		algebraicType: ctx.registerTypesRecursively("typeBuilder" in c ? c.typeBuilder : c).algebraicType
	})) };
	const returnType = ctx.registerTypesRecursively(ret).algebraicType;
	ctx.moduleDef.procedures.push({
		sourceName: exportName,
		params: paramsType,
		returnType,
		visibility: FunctionVisibility.ClientCallable
	});
	const { typespace } = ctx;
	ctx.procedures.push({
		fn,
		deserializeArgs: ProductType.makeDeserializer(paramsType, typespace),
		serializeReturn: AlgebraicType.makeSerializer(returnType, typespace),
		returnTypeBaseSize: bsatnBaseSize(typespace, returnType)
	});
}
function callProcedure(moduleCtx, id, sender, connectionId, timestamp, argsBuf, dbView) {
	const { fn, deserializeArgs, serializeReturn, returnTypeBaseSize } = moduleCtx.procedures[id];
	const args = deserializeArgs(new BinaryReader(argsBuf));
	const ret = callUserFunction(fn, new ProcedureCtxImpl(sender, timestamp, connectionId, dbView), args);
	const retBuf = new BinaryWriter(returnTypeBaseSize);
	serializeReturn(retBuf, ret);
	return retBuf.getBuffer();
}
var ProcedureCtxImpl = class ProcedureCtx {
	constructor(sender, timestamp, connectionId, dbView) {
		this.sender = sender;
		this.timestamp = timestamp;
		this.connectionId = connectionId;
		this.#dbView = dbView;
	}
	#identity;
	#uuidCounter;
	#random;
	#dbView;
	get databaseIdentity() {
		return this.#identity ??= new Identity(sys.identity());
	}
	get identity() {
		return this.databaseIdentity;
	}
	get random() {
		return this.#random ??= makeRandom(this.timestamp);
	}
	get http() {
		return httpClient;
	}
	withTx(body) {
		return runWithTx((timestamp) => new TransactionCtxImpl(this.sender, timestamp, this.connectionId, this.#dbView()), body);
	}
	newUuidV4() {
		const bytes = this.random.fill(new Uint8Array(16));
		return Uuid.fromRandomBytesV4(bytes);
	}
	newUuidV7() {
		const bytes = this.random.fill(new Uint8Array(4));
		const counter = this.#uuidCounter ??= { value: 0 };
		return Uuid.fromCounterV7(counter, this.timestamp, bytes);
	}
};
function makeReducerExport(ctx, opts, params, fn, lifecycle) {
	const reducerExport = (...args) => fn(...args);
	reducerExport[exportContext] = ctx;
	reducerExport[registerExport] = (ctx2, exportName) => {
		registerReducer(ctx2, exportName, params, fn, opts, lifecycle);
		ctx2.functionExports.set(reducerExport, exportName);
		if (opts?.onSchedule !== void 0) ctx2.pendingSchedules.push({
			table: opts.onSchedule,
			functionName: exportName
		});
	};
	return reducerExport;
}
function registerReducer(ctx, exportName, params, fn, opts, lifecycle) {
	ctx.defineFunction(exportName);
	if (!(params instanceof RowBuilder)) params = new RowBuilder(params);
	if (params.typeName === void 0) params.typeName = toPascalCase(exportName);
	const ref = ctx.registerTypesRecursively(params);
	const paramsType = ctx.resolveType(ref).value;
	const isLifecycle = lifecycle != null;
	ctx.moduleDef.reducers.push({
		sourceName: exportName,
		params: paramsType,
		visibility: FunctionVisibility.ClientCallable,
		okReturnType: AlgebraicType.Product({ elements: [] }),
		errReturnType: AlgebraicType.String
	});
	if (opts?.name != null) ctx.moduleDef.explicitNames.entries.push({
		tag: "Function",
		value: {
			sourceName: exportName,
			canonicalName: opts.name
		}
	});
	if (isLifecycle) ctx.moduleDef.lifeCycleReducers.push({
		lifecycleSpec: lifecycle,
		functionName: exportName
	});
	if (!fn.name) Object.defineProperty(fn, "name", {
		value: exportName,
		writable: false
	});
	ctx.reducers.push(fn);
}
var SchemaInner = class extends ModuleContext {
	schemaType;
	existingFunctions = /* @__PURE__ */ new Set();
	existingHttpHandlers = /* @__PURE__ */ new Set();
	reducers = [];
	procedures = [];
	views = [];
	anonViews = [];
	httpHandlers = [];
	/**
	* Maps reducer/procedure export objects to their source names.
	* Used for resolving scheduled table targets.
	*/
	functionExports = /* @__PURE__ */ new Map();
	tableSourceNames = /* @__PURE__ */ new Map();
	httpHandlerExports = /* @__PURE__ */ new Map();
	pendingSchedules = [];
	pendingHttpRoutes = [];
	constructor(getSchemaType) {
		super();
		this.schemaType = getSchemaType(this);
	}
	defineFunction(name) {
		if (this.existingFunctions.has(name)) throw new TypeError(`There is already a reducer, procedure, or view with the name '${name}'`);
		this.existingFunctions.add(name);
	}
	defineHttpHandler(name) {
		if (this.existingHttpHandlers.has(name)) throw new TypeError(`There is already an HTTP handler with the name '${name}'`);
		this.existingHttpHandlers.add(name);
	}
	resolveSchedules() {
		const scheduledTables = /* @__PURE__ */ new Map();
		for (const { functionName: knownFunctionName, reducer, table: table2, tableName: knownTableName, scheduleAtCol: knownScheduleAtCol } of this.pendingSchedules) {
			let tableName = knownTableName;
			if (tableName === void 0) {
				const tableNames = this.tableSourceNames.get(table2);
				if (tableNames !== void 0 && tableNames.length > 1) throw new TypeError("Schedule target table is registered more than once in this schema. Use a distinct table handle for each scheduled table.");
				tableName = tableNames?.[0];
			}
			if (tableName === void 0) throw new TypeError("Schedule target table is not part of this schema.");
			const scheduleAtCol = knownScheduleAtCol ?? table2.scheduleAtCol;
			if (scheduleAtCol === void 0) throw new TypeError(`Table ${tableName} defines a schedule, but it does not have a ScheduleAt column.`);
			const functionName = knownFunctionName ?? (reducer === void 0 ? void 0 : this.functionExports.get(reducer()));
			if (functionName === void 0) {
				const msg = `Table ${tableName} defines a schedule, but it seems like the associated function was not exported.`;
				throw new TypeError(msg);
			}
			const existingFunctionName = scheduledTables.get(tableName);
			if (existingFunctionName !== void 0) throw new TypeError(`Table ${tableName} defines multiple schedules: ${existingFunctionName} and ${functionName}. A schedule table can only be used by one reducer or procedure.`);
			scheduledTables.set(tableName, functionName);
			this.moduleDef.schedules.push({
				sourceName: void 0,
				tableName,
				scheduleAtCol,
				functionName
			});
		}
	}
	resolveHttpRoutes() {
		for (const route of this.pendingHttpRoutes) {
			const handlerFunction = this.httpHandlerExports.get(route.handler);
			if (handlerFunction === void 0) throw new TypeError(`HTTP route for path '${route.path}' refers to a handler that was not exported.`);
			this.moduleDef.httpRoutes.push({
				handlerFunction,
				method: route.method,
				path: route.path
			});
		}
	}
};
var Schema = class {
	#ctx;
	constructor(ctx) {
		this.#ctx = ctx;
	}
	[moduleHooks](exports) {
		const registeredSchema = this.#ctx;
		for (const [name, moduleExport] of Object.entries(exports)) {
			if (name === "default") continue;
			if (!isModuleExport(moduleExport)) throw new TypeError("exporting something that is not a spacetime export");
			checkExportContext(moduleExport, registeredSchema);
			moduleExport[registerExport](registeredSchema, name);
		}
		registeredSchema.resolveSchedules();
		registeredSchema.resolveHttpRoutes();
		return makeHooks(registeredSchema);
	}
	get schemaType() {
		return this.#ctx.schemaType;
	}
	get moduleDef() {
		return this.#ctx.moduleDef;
	}
	get typespace() {
		return this.#ctx.typespace;
	}
	reducer(...args) {
		let opts, params = {}, fn;
		switch (args.length) {
			case 1:
				[fn] = args;
				break;
			case 2: {
				let arg1;
				[arg1, fn] = args;
				if (typeof arg1.name === "string") opts = arg1;
				else params = arg1;
				break;
			}
			case 3:
				[opts, params, fn] = args;
				break;
		}
		return makeReducerExport(this.#ctx, opts, params, fn);
	}
	init(...args) {
		let opts, fn;
		switch (args.length) {
			case 1:
				[fn] = args;
				break;
			case 2:
				[opts, fn] = args;
				break;
		}
		return makeReducerExport(this.#ctx, opts, {}, fn, Lifecycle.Init);
	}
	clientConnected(...args) {
		let opts, fn;
		switch (args.length) {
			case 1:
				[fn] = args;
				break;
			case 2:
				[opts, fn] = args;
				break;
		}
		return makeReducerExport(this.#ctx, opts, {}, fn, Lifecycle.OnConnect);
	}
	clientDisconnected(...args) {
		let opts, fn;
		switch (args.length) {
			case 1:
				[fn] = args;
				break;
			case 2:
				[opts, fn] = args;
				break;
		}
		return makeReducerExport(this.#ctx, opts, {}, fn, Lifecycle.OnDisconnect);
	}
	view(opts, ret, fn, ..._) {
		return makeViewExport(this.#ctx, opts, {}, ret, fn);
	}
	anonymousView(opts, ret, fn, ..._) {
		return makeAnonViewExport(this.#ctx, opts, {}, ret, fn);
	}
	procedure(...args) {
		let opts, params = {}, ret, fn;
		switch (args.length) {
			case 2:
				[ret, fn] = args;
				break;
			case 3: {
				let arg1;
				[arg1, ret, fn] = args;
				if (typeof arg1.name === "string") opts = arg1;
				else params = arg1;
				break;
			}
			case 4:
				[opts, params, ret, fn] = args;
				break;
		}
		return makeProcedureExport(this.#ctx, opts, params, ret, fn);
	}
	httpHandler(...args) {
		let opts, fn;
		switch (args.length) {
			case 1:
				[fn] = args;
				break;
			case 2:
				[opts, fn] = args;
				break;
		}
		return makeHttpHandlerExport(this.#ctx, opts, fn);
	}
	httpRouter(router) {
		return makeHttpRouterExport(this.#ctx, router);
	}
	/**
	* Bundle multiple reducers, procedures, etc into one value to export.
	* The name they will be exported with is their corresponding key in the `exports` argument.
	*/
	exportGroup(exports) {
		return {
			[exportContext]: this.#ctx,
			[registerExport](ctx, _exportName) {
				for (const [exportName, moduleExport] of Object.entries(exports)) {
					checkExportContext(moduleExport, ctx);
					moduleExport[registerExport](ctx, exportName);
				}
			}
		};
	}
	clientVisibilityFilter = { sql: (filter) => ({
		[exportContext]: this.#ctx,
		[registerExport](ctx, _exportName) {
			ctx.moduleDef.rowLevelSecurity.push({ sql: filter });
		}
	}) };
};
var registerExport = Symbol("SpacetimeDB.registerExport");
var exportContext = Symbol("SpacetimeDB.exportContext");
function isModuleExport(x) {
	return (typeof x === "function" || typeof x === "object") && x !== null && registerExport in x;
}
function checkExportContext(exp, schema2) {
	if (exp[exportContext] != null && exp[exportContext] !== schema2) throw new TypeError("multiple schemas are not supported");
}
function schema(tables, moduleSettings) {
	return new Schema(new SchemaInner((ctx2) => {
		if (moduleSettings?.CASE_CONVERSION_POLICY != null) ctx2.setCaseConversionPolicy(moduleSettings.CASE_CONVERSION_POLICY);
		const tableSchemas = {};
		for (const [accName, table2] of Object.entries(tables)) {
			const tableDef = table2.tableDef(ctx2, accName);
			tableSchemas[accName] = tableToSchema(accName, table2, tableDef);
			const tableSourceNames = ctx2.tableSourceNames.get(table2);
			if (tableSourceNames === void 0) ctx2.tableSourceNames.set(table2, [tableDef.sourceName]);
			else tableSourceNames.push(tableDef.sourceName);
			ctx2.moduleDef.tables.push(tableDef);
			if (table2.schedule) ctx2.pendingSchedules.push({
				table: table2,
				tableName: tableDef.sourceName,
				scheduleAtCol: table2.schedule.scheduleAtCol,
				reducer: table2.schedule.reducer
			});
			if (table2.tableName) ctx2.moduleDef.explicitNames.entries.push({
				tag: "Table",
				value: {
					sourceName: accName,
					canonicalName: table2.tableName
				}
			});
		}
		return { tables: tableSchemas };
	}));
}
var import_object_inspect = __toESM(require_object_inspect());
var fmtLog = (...data) => data.map((x) => typeof x === "string" ? x : (0, import_object_inspect.default)(x)).join(" ");
var console_level_error = 0;
var console_level_warn = 1;
var console_level_info = 2;
var console_level_debug = 3;
var console_level_trace = 4;
var timerMap = /* @__PURE__ */ new Map();
var console2 = {
	__proto__: {},
	[Symbol.toStringTag]: "console",
	assert: (condition = false, ...data) => {
		if (!condition) sys.console_log(console_level_error, fmtLog(...data));
	},
	clear: () => {},
	debug: (...data) => {
		sys.console_log(console_level_debug, fmtLog(...data));
	},
	error: (...data) => {
		sys.console_log(console_level_error, fmtLog(...data));
	},
	info: (...data) => {
		sys.console_log(console_level_info, fmtLog(...data));
	},
	log: (...data) => {
		sys.console_log(console_level_info, fmtLog(...data));
	},
	table: (tabularData, _properties) => {
		sys.console_log(console_level_info, fmtLog(tabularData));
	},
	trace: (...data) => {
		sys.console_log(console_level_trace, fmtLog(...data));
	},
	warn: (...data) => {
		sys.console_log(console_level_warn, fmtLog(...data));
	},
	dir: (_item, _options) => {},
	dirxml: (..._data) => {},
	count: (_label = "default") => {},
	countReset: (_label = "default") => {},
	group: (..._data) => {},
	groupCollapsed: (..._data) => {},
	groupEnd: () => {},
	time: (label = "default") => {
		if (timerMap.has(label)) {
			sys.console_log(console_level_warn, `Timer '${label}' already exists.`);
			return;
		}
		timerMap.set(label, sys.console_timer_start(label));
	},
	timeLog: (label = "default", ...data) => {
		sys.console_log(console_level_info, fmtLog(label, ...data));
	},
	timeEnd: (label = "default") => {
		const spanId = timerMap.get(label);
		if (spanId === void 0) {
			sys.console_log(console_level_warn, `Timer '${label}' does not exist.`);
			return;
		}
		sys.console_timer_end(spanId);
		timerMap.delete(label);
	},
	timeStamp: () => {},
	profile: () => {},
	profileEnd: () => {}
};
globalThis.console = console2;

//#endregion
//#region src/index.ts
const persona = table({ name: "persona" }, {
	identity: t.identity().primaryKey(),
	name: t.string().unique()
});
const organization = table({ name: "organization" }, {
	id: t.string().primaryKey(),
	name: t.string()
});
const organizationMembership = table({ name: "organization_membership" }, {
	id: t.string().primaryKey(),
	organizationId: t.string().index("btree"),
	identity: t.identity().index("btree"),
	role: t.string(),
	active: t.bool()
});
const team = table({ name: "team" }, {
	id: t.string().primaryKey(),
	organizationId: t.string().index("btree"),
	name: t.string()
});
const teamMembership = table({ name: "team_membership" }, {
	id: t.string().primaryKey(),
	teamId: t.string().index("btree"),
	identity: t.identity().index("btree"),
	role: t.string(),
	active: t.bool()
});
const project = table({ name: "project" }, {
	id: t.string().primaryKey(),
	organizationId: t.string().index("btree"),
	teamId: t.string().index("btree"),
	name: t.string()
});
const label = table({ name: "label" }, {
	id: t.string().primaryKey(),
	organizationId: t.string().index("btree"),
	name: t.string(),
	color: t.string()
});
const issue = table({ name: "issue" }, {
	id: t.string().primaryKey(),
	identifier: t.string().unique(),
	organizationId: t.string().index("btree"),
	teamId: t.string().index("btree"),
	projectId: t.string().index("btree"),
	title: t.string(),
	description: t.string(),
	status: t.string().index("btree"),
	priority: t.string().index("btree"),
	assigneeName: t.string().index("btree"),
	boardPosition: t.u32().index("btree"),
	sortKey: t.string().index("btree"),
	revision: t.u64(),
	createdAt: t.timestamp(),
	updatedAt: t.timestamp(),
	customerImpact: t.string().default("normal").index("btree")
});
const issueLabel = table({ name: "issue_label" }, {
	id: t.string().primaryKey(),
	issueId: t.string().index("btree"),
	labelId: t.string().index("btree")
});
const comment = table({ name: "comment" }, {
	id: t.u64().primaryKey().autoInc(),
	issueId: t.string().index("btree"),
	author: t.identity().index("btree"),
	authorName: t.string(),
	body: t.string(),
	createdAt: t.timestamp()
});
const activity = table({ name: "activity" }, {
	id: t.u64().primaryKey().autoInc(),
	issueId: t.string().index("btree"),
	actor: t.identity().index("btree"),
	actorName: t.string(),
	kind: t.string().index("btree"),
	detail: t.string(),
	createdAt: t.timestamp()
});
const pageResult = table({ name: "page_result" }, {
	id: t.string().primaryKey(),
	requestId: t.string().index("btree"),
	owner: t.identity().index("btree"),
	issueId: t.string(),
	identifier: t.string(),
	title: t.string(),
	status: t.string(),
	priority: t.string(),
	assigneeName: t.string(),
	projectId: t.string(),
	boardPosition: t.u32(),
	sortKey: t.string(),
	revision: t.u64()
});
const spacetimedb = schema({
	persona,
	organization,
	organizationMembership,
	team,
	teamMembership,
	project,
	label,
	issue,
	issueLabel,
	comment,
	activity,
	pageResult
});
const PRIMARY_ORGANIZATION = "org-primary";
const SECONDARY_ORGANIZATION = "org-secondary";
const STATUSES = [
	"backlog",
	"todo",
	"in-progress",
	"review",
	"done"
];
const PRIORITIES = [
	"urgent",
	"high",
	"medium",
	"low"
];
function identityKey(identity) {
	return identity.toHexString();
}
function requirePersona(ctx) {
	const row = ctx.db.persona.identity.find(ctx.sender);
	if (!row) throw new Error("LINEAR_PERSONA_REQUIRED");
	return row;
}
function activeOrganizationMembership(ctx, identity, organizationId) {
	const id = `${organizationId}:${identityKey(identity)}`;
	const row = ctx.db.organizationMembership.id.find(id);
	return row?.active ? row : void 0;
}
function activeTeamMembership(ctx, identity, teamId) {
	const id = `${teamId}:${identityKey(identity)}`;
	const row = ctx.db.teamMembership.id.find(id);
	return row?.active ? row : void 0;
}
function canReadIssue(ctx, target) {
	if (activeOrganizationMembership(ctx, ctx.sender, target.organizationId)?.role === "owner") return true;
	return Boolean(activeTeamMembership(ctx, ctx.sender, target.teamId));
}
function requireReadableIssue(ctx, issueId) {
	requirePersona(ctx);
	const target = ctx.db.issue.id.find(issueId);
	if (!target || !canReadIssue(ctx, target)) throw new Error("LINEAR_NOT_AUTHORIZED");
	return target;
}
function requireOwner(ctx) {
	const actor = requirePersona(ctx);
	const membership = activeOrganizationMembership(ctx, ctx.sender, PRIMARY_ORGANIZATION);
	if (!membership || membership.role !== "owner") throw new Error("LINEAR_OWNER_REQUIRED");
	return actor;
}
function addActivity(ctx, issueId, actor, kind, detail) {
	ctx.db.activity.insert({
		id: 0n,
		issueId,
		actor: actor.identity,
		actorName: actor.name,
		kind,
		detail,
		createdAt: ctx.timestamp
	});
}
const registerPersona = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
	if (![
		"Alice",
		"Bob",
		"Mallory"
	].includes(name)) throw new Error("LINEAR_UNKNOWN_PERSONA");
	const current = ctx.db.persona.identity.find(ctx.sender);
	if (current && current.name !== name) throw new Error("LINEAR_IDENTITY_ALREADY_BOUND");
	const claimed = ctx.db.persona.name.find(name);
	if (claimed && identityKey(claimed.identity) !== identityKey(ctx.sender)) throw new Error("LINEAR_PERSONA_ALREADY_CLAIMED");
	if (!current) ctx.db.persona.insert({
		identity: ctx.sender,
		name
	});
});
const seedFixtures = spacetimedb.reducer((ctx) => {
	if (requirePersona(ctx).name !== "Alice") throw new Error("LINEAR_ONLY_ALICE_SEEDS");
	if (ctx.db.organization.id.find(PRIMARY_ORGANIZATION)) throw new Error("LINEAR_FIXTURE_ALREADY_SEEDED");
	const alice = ctx.db.persona.name.find("Alice");
	const bob = ctx.db.persona.name.find("Bob");
	const mallory = ctx.db.persona.name.find("Mallory");
	if (!alice || !bob || !mallory) throw new Error("LINEAR_ALL_PERSONAS_REQUIRED");
	ctx.db.organization.insert({
		id: PRIMARY_ORGANIZATION,
		name: "Acme Systems"
	});
	ctx.db.organization.insert({
		id: SECONDARY_ORGANIZATION,
		name: "Control Organization"
	});
	ctx.db.organizationMembership.insert({
		id: `${PRIMARY_ORGANIZATION}:${identityKey(alice.identity)}`,
		organizationId: PRIMARY_ORGANIZATION,
		identity: alice.identity,
		role: "owner",
		active: true
	});
	ctx.db.organizationMembership.insert({
		id: `${PRIMARY_ORGANIZATION}:${identityKey(bob.identity)}`,
		organizationId: PRIMARY_ORGANIZATION,
		identity: bob.identity,
		role: "member",
		active: true
	});
	const teams = [
		"Platform",
		"Client",
		"Infrastructure"
	].map((name, index) => ({
		id: `team-${index + 1}`,
		organizationId: PRIMARY_ORGANIZATION,
		name
	}));
	for (const target of teams) {
		ctx.db.team.insert(target);
		for (const member of [{
			identity: alice.identity,
			role: "owner"
		}, {
			identity: bob.identity,
			role: "member"
		}]) ctx.db.teamMembership.insert({
			id: `${target.id}:${identityKey(member.identity)}`,
			teamId: target.id,
			identity: member.identity,
			role: member.role,
			active: true
		});
	}
	const projects = [
		"Atlas",
		"Beacon",
		"Comet",
		"Delta"
	].map((name, index) => ({
		id: `project-${index + 1}`,
		organizationId: PRIMARY_ORGANIZATION,
		teamId: teams[index % teams.length].id,
		name
	}));
	for (const target of projects) ctx.db.project.insert(target);
	const labels = Array.from({ length: 20 }, (_, index) => ({
		id: `label-${String(index + 1).padStart(2, "0")}`,
		organizationId: PRIMARY_ORGANIZATION,
		name: `Label ${String(index + 1).padStart(2, "0")}`,
		color: `hsl(${index * 18} 60% 55%)`
	}));
	for (const target of labels) ctx.db.label.insert(target);
	for (let ordinal = 1; ordinal <= 500; ordinal += 1) {
		const id = `issue-${String(ordinal).padStart(3, "0")}`;
		const teamId = teams[(ordinal - 1) % teams.length].id;
		const projectId = projects[(ordinal - 1) % projects.length].id;
		const status = STATUSES[(ordinal - 1) % STATUSES.length];
		const priority = PRIORITIES[(ordinal - 1) % PRIORITIES.length];
		const assigneeName = ordinal % 2 === 0 ? "Alice" : "Bob";
		ctx.db.issue.insert({
			id,
			identifier: `LIN-${String(ordinal).padStart(3, "0")}`,
			organizationId: PRIMARY_ORGANIZATION,
			teamId,
			projectId,
			title: `Production issue ${String(ordinal).padStart(3, "0")}`,
			description: `Deterministic production-shaped description for issue ${ordinal}.`,
			status,
			priority,
			assigneeName,
			boardPosition: ordinal - 1,
			sortKey: `${String(ordinal).padStart(6, "0")}:${id}`,
			revision: 1n,
			customerImpact: "normal",
			createdAt: ctx.timestamp,
			updatedAt: ctx.timestamp
		});
		for (const labelOffset of [0, 7]) {
			const labelId = labels[(ordinal - 1 + labelOffset) % labels.length].id;
			ctx.db.issueLabel.insert({
				id: `${id}:${labelId}`,
				issueId: id,
				labelId
			});
		}
		for (let commentIndex = 1; commentIndex <= 2; commentIndex += 1) {
			const author = commentIndex % 2 === 1 ? alice : bob;
			ctx.db.comment.insert({
				id: 0n,
				issueId: id,
				author: author.identity,
				authorName: author.name,
				body: `Fixture comment ${commentIndex} for LIN-${String(ordinal).padStart(3, "0")}`,
				createdAt: ctx.timestamp
			});
		}
		addActivity(ctx, id, alice, "seeded", "Issue created by deterministic seed");
	}
});
const requestIssuePage = spacetimedb.reducer({
	requestId: t.string(),
	status: t.string(),
	assigneeName: t.string(),
	projectId: t.string(),
	labelId: t.string(),
	afterSortKey: t.string()
}, (ctx, filters) => {
	requirePersona(ctx);
	const ownedRequest = `${identityKey(ctx.sender)}:${filters.requestId}`;
	for (const old of Array.from(ctx.db.pageResult.requestId.filter(ownedRequest))) ctx.db.pageResult.id.delete(old.id);
	let candidates;
	if (filters.status) candidates = Array.from(ctx.db.issue.status.filter(filters.status));
	else if (filters.assigneeName) candidates = Array.from(ctx.db.issue.assigneeName.filter(filters.assigneeName));
	else if (filters.projectId) candidates = Array.from(ctx.db.issue.projectId.filter(filters.projectId));
	else candidates = Array.from(ctx.db.issue.organizationId.filter(PRIMARY_ORGANIZATION));
	const rows = candidates.filter((row) => canReadIssue(ctx, row)).filter((row) => !filters.status || row.status === filters.status).filter((row) => !filters.assigneeName || row.assigneeName === filters.assigneeName).filter((row) => !filters.projectId || row.projectId === filters.projectId).filter((row) => !filters.labelId || Boolean(ctx.db.issueLabel.id.find(`${row.id}:${filters.labelId}`))).filter((row) => !filters.afterSortKey || row.sortKey > filters.afterSortKey).sort((left, right) => left.sortKey.localeCompare(right.sortKey)).slice(0, 50);
	for (const row of rows) ctx.db.pageResult.insert({
		id: `${ownedRequest}:${row.id}`,
		requestId: ownedRequest,
		owner: ctx.sender,
		issueId: row.id,
		identifier: row.identifier,
		title: row.title,
		status: row.status,
		priority: row.priority,
		assigneeName: row.assigneeName,
		projectId: row.projectId,
		boardPosition: row.boardPosition,
		sortKey: row.sortKey,
		revision: row.revision
	});
});
const createIssue = spacetimedb.reducer({
	id: t.string(),
	identifier: t.string(),
	teamId: t.string(),
	projectId: t.string(),
	title: t.string(),
	status: t.string(),
	priority: t.string(),
	assigneeName: t.string(),
	boardPosition: t.u32(),
	sortKey: t.string()
}, (ctx, input) => {
	const actor = requirePersona(ctx);
	if (!canReadIssue(ctx, {
		organizationId: PRIMARY_ORGANIZATION,
		teamId: input.teamId
	})) throw new Error("LINEAR_NOT_AUTHORIZED");
	if (ctx.db.issue.id.find(input.id)) throw new Error("LINEAR_DUPLICATE_ISSUE");
	if (!ctx.db.project.id.find(input.projectId)) throw new Error("LINEAR_PROJECT_NOT_FOUND");
	ctx.db.issue.insert({
		...input,
		organizationId: PRIMARY_ORGANIZATION,
		description: "Created during acceptance.",
		revision: 1n,
		customerImpact: "normal",
		createdAt: ctx.timestamp,
		updatedAt: ctx.timestamp
	});
	addActivity(ctx, input.id, actor, "created", input.title);
});
const updateIssue = spacetimedb.reducer({
	issueId: t.string(),
	expectedRevision: t.u64(),
	status: t.string(),
	priority: t.string(),
	assigneeName: t.string(),
	boardPosition: t.u32()
}, (ctx, input) => {
	const actor = requirePersona(ctx);
	const current = requireReadableIssue(ctx, input.issueId);
	if (current.revision !== input.expectedRevision) throw new Error("LINEAR_REVISION_CONFLICT");
	ctx.db.issue.id.update({
		...current,
		status: input.status,
		priority: input.priority,
		assigneeName: input.assigneeName,
		boardPosition: input.boardPosition,
		revision: current.revision + 1n,
		updatedAt: ctx.timestamp
	});
	addActivity(ctx, current.id, actor, "updated", `revision ${current.revision.toString()} -> ${(current.revision + 1n).toString()}`);
});
const addComment = spacetimedb.reducer({
	issueId: t.string(),
	body: t.string()
}, (ctx, { issueId, body }) => {
	const actor = requirePersona(ctx);
	requireReadableIssue(ctx, issueId);
	if (!body || body.length > 4e3) throw new Error("LINEAR_INVALID_COMMENT");
	ctx.db.comment.insert({
		id: 0n,
		issueId,
		author: ctx.sender,
		authorName: actor.name,
		body,
		createdAt: ctx.timestamp
	});
	addActivity(ctx, issueId, actor, "commented", body.slice(0, 120));
});
const setCustomerImpact = spacetimedb.reducer({
	issueId: t.string(),
	expectedRevision: t.u64(),
	customerImpact: t.string()
}, (ctx, { issueId, expectedRevision, customerImpact }) => {
	const actor = requirePersona(ctx);
	const current = requireReadableIssue(ctx, issueId);
	if (current.revision !== expectedRevision) throw new Error("LINEAR_REVISION_CONFLICT");
	if (![
		"low",
		"normal",
		"high",
		"critical"
	].includes(customerImpact)) throw new Error("LINEAR_INVALID_CUSTOMER_IMPACT");
	ctx.db.issue.id.update({
		...current,
		customerImpact,
		revision: current.revision + 1n,
		updatedAt: ctx.timestamp
	});
	addActivity(ctx, issueId, actor, "customer-impact", customerImpact);
});
const ownerOnlyProbe = spacetimedb.reducer((ctx) => {
	requireOwner(ctx);
});
const myOrganizations = spacetimedb.view({
	name: "my_organizations",
	public: true
}, t.array(organization.rowType), (ctx) => {
	const rows = [];
	for (const membership of ctx.db.organizationMembership.identity.filter(ctx.sender)) {
		if (!membership.active) continue;
		const target = ctx.db.organization.id.find(membership.organizationId);
		if (target) rows.push(target);
	}
	return rows;
});
const myTeams = spacetimedb.view({
	name: "my_teams",
	public: true
}, t.array(team.rowType), (ctx) => {
	const rows = [];
	const seen = /* @__PURE__ */ new Set();
	for (const membership of ctx.db.organizationMembership.identity.filter(ctx.sender)) {
		if (!membership.active || membership.role !== "owner") continue;
		for (const target of ctx.db.team.organizationId.filter(membership.organizationId)) {
			rows.push(target);
			seen.add(target.id);
		}
	}
	for (const membership of ctx.db.teamMembership.identity.filter(ctx.sender)) {
		if (!membership.active || seen.has(membership.teamId)) continue;
		const target = ctx.db.team.id.find(membership.teamId);
		if (target) rows.push(target);
	}
	return rows;
});
const myProjects = spacetimedb.view({
	name: "my_projects",
	public: true
}, t.array(project.rowType), (ctx) => {
	const rows = [];
	const seen = /* @__PURE__ */ new Set();
	for (const membership of ctx.db.organizationMembership.identity.filter(ctx.sender)) {
		if (!membership.active) continue;
		for (const target of ctx.db.project.organizationId.filter(membership.organizationId)) {
			if (!seen.has(target.id)) rows.push(target);
			seen.add(target.id);
		}
	}
	return rows;
});
const myLabels = spacetimedb.view({
	name: "my_labels",
	public: true
}, t.array(label.rowType), (ctx) => {
	const rows = [];
	const seen = /* @__PURE__ */ new Set();
	for (const membership of ctx.db.organizationMembership.identity.filter(ctx.sender)) {
		if (!membership.active) continue;
		for (const target of ctx.db.label.organizationId.filter(membership.organizationId)) {
			if (!seen.has(target.id)) rows.push(target);
			seen.add(target.id);
		}
	}
	return rows;
});
const myIssues = spacetimedb.view({
	name: "my_issues",
	public: true
}, t.array(issue.rowType), (ctx) => {
	const rows = [];
	const seen = /* @__PURE__ */ new Set();
	for (const membership of ctx.db.organizationMembership.identity.filter(ctx.sender)) {
		if (!membership.active || membership.role !== "owner") continue;
		for (const target of ctx.db.issue.organizationId.filter(membership.organizationId)) {
			rows.push(target);
			seen.add(target.id);
		}
	}
	for (const membership of ctx.db.teamMembership.identity.filter(ctx.sender)) {
		if (!membership.active) continue;
		for (const target of ctx.db.issue.teamId.filter(membership.teamId)) {
			if (!seen.has(target.id)) rows.push(target);
			seen.add(target.id);
		}
	}
	return rows;
});
const myIssueLabels = spacetimedb.view({
	name: "my_issue_labels",
	public: true
}, t.array(issueLabel.rowType), (ctx) => {
	const rows = [];
	for (const target of ctx.db.issue.organizationId.filter(PRIMARY_ORGANIZATION)) {
		if (!canReadIssue(ctx, target)) continue;
		rows.push(...Array.from(ctx.db.issueLabel.issueId.filter(target.id)));
	}
	return rows;
});
const myComments = spacetimedb.view({
	name: "my_comments",
	public: true
}, t.array(comment.rowType), (ctx) => {
	const rows = [];
	for (const target of ctx.db.issue.organizationId.filter(PRIMARY_ORGANIZATION)) {
		if (!canReadIssue(ctx, target)) continue;
		rows.push(...Array.from(ctx.db.comment.issueId.filter(target.id)));
	}
	return rows;
});
const myActivities = spacetimedb.view({
	name: "my_activities",
	public: true
}, t.array(activity.rowType), (ctx) => {
	const rows = [];
	for (const target of ctx.db.issue.organizationId.filter(PRIMARY_ORGANIZATION)) {
		if (!canReadIssue(ctx, target)) continue;
		rows.push(...Array.from(ctx.db.activity.issueId.filter(target.id)));
	}
	return rows;
});
const myPageResults = spacetimedb.view({
	name: "my_page_results",
	public: true
}, t.array(pageResult.rowType), (ctx) => Array.from(ctx.db.pageResult.owner.filter(ctx.sender)));

//#endregion
export { addComment, createIssue, spacetimedb as default, myActivities, myComments, myIssueLabels, myIssues, myLabels, myOrganizations, myPageResults, myProjects, myTeams, ownerOnlyProbe, registerPersona, requestIssuePage, seedFixtures, setCustomerImpact, updateIssue };
//# debugId=09e5e8e2-802c-48dc-81d2-cc7a3de676b2
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVuZGxlLmpzIiwibmFtZXMiOlsiX19jcmVhdGUiLCJfX2RlZlByb3AiLCJfX2dldE93blByb3BEZXNjIiwiX19nZXRPd25Qcm9wTmFtZXMiLCJfX2dldFByb3RvT2YiLCJfX2hhc093blByb3AiLCJfX2NvbW1vbkpTIiwiX19jb3B5UHJvcHMiLCJfX3RvRVNNIiwiI2Vuc3VyZSIsIiNtb2R1bGVEZWYiLCIjcmVnaXN0ZXJDb21wb3VuZFR5cGVSZWN1cnNpdmVseSIsIiNjb21wb3VuZFR5cGVzIiwiI2JvZHkiLCIjaW5uZXIiLCIjZnJvbSIsIiN0byIsIiN1dWlkQ291bnRlciIsIiNzZW5kZXJBdXRoIiwiI2lkZW50aXR5IiwiI3JhbmRvbSIsIiNzY2hlbWEiLCIjcmVkdWNlckFyZ3NEZXNlcmlhbGl6ZXJzIiwiI2RiVmlldyIsIiNkYlZpZXdfIiwiI3JlZHVjZXJDdHgiLCIjcmVkdWNlckN0eF8iLCIjZmluYWxpemF0aW9uUmVnaXN0cnkiLCIjaWQiLCIjZGV0YWNoIiwiI2N0eCJdLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9oZWFkZXJzLXBvbHlmaWxsL2xpYi9pbmRleC5tanMiLCJub2RlX21vZHVsZXMvc3BhY2V0aW1lZGIvZGlzdC9zZXJ2ZXIvaW5kZXgubWpzIiwic3JjL2luZGV4LnRzIl0sInNvdXJjZXNDb250ZW50IjpbInZhciBfX2NyZWF0ZSA9IE9iamVjdC5jcmVhdGU7XG52YXIgX19kZWZQcm9wID0gT2JqZWN0LmRlZmluZVByb3BlcnR5O1xudmFyIF9fZ2V0T3duUHJvcERlc2MgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yO1xudmFyIF9fZ2V0T3duUHJvcE5hbWVzID0gT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXM7XG52YXIgX19nZXRQcm90b09mID0gT2JqZWN0LmdldFByb3RvdHlwZU9mO1xudmFyIF9faGFzT3duUHJvcCA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHk7XG52YXIgX19jb21tb25KUyA9IChjYiwgbW9kKSA9PiBmdW5jdGlvbiBfX3JlcXVpcmUoKSB7XG4gIHJldHVybiBtb2QgfHwgKDAsIGNiW19fZ2V0T3duUHJvcE5hbWVzKGNiKVswXV0pKChtb2QgPSB7IGV4cG9ydHM6IHt9IH0pLmV4cG9ydHMsIG1vZCksIG1vZC5leHBvcnRzO1xufTtcbnZhciBfX2NvcHlQcm9wcyA9ICh0bywgZnJvbSwgZXhjZXB0LCBkZXNjKSA9PiB7XG4gIGlmIChmcm9tICYmIHR5cGVvZiBmcm9tID09PSBcIm9iamVjdFwiIHx8IHR5cGVvZiBmcm9tID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICBmb3IgKGxldCBrZXkgb2YgX19nZXRPd25Qcm9wTmFtZXMoZnJvbSkpXG4gICAgICBpZiAoIV9faGFzT3duUHJvcC5jYWxsKHRvLCBrZXkpICYmIGtleSAhPT0gZXhjZXB0KVxuICAgICAgICBfX2RlZlByb3AodG8sIGtleSwgeyBnZXQ6ICgpID0+IGZyb21ba2V5XSwgZW51bWVyYWJsZTogIShkZXNjID0gX19nZXRPd25Qcm9wRGVzYyhmcm9tLCBrZXkpKSB8fCBkZXNjLmVudW1lcmFibGUgfSk7XG4gIH1cbiAgcmV0dXJuIHRvO1xufTtcbnZhciBfX3RvRVNNID0gKG1vZCwgaXNOb2RlTW9kZSwgdGFyZ2V0KSA9PiAodGFyZ2V0ID0gbW9kICE9IG51bGwgPyBfX2NyZWF0ZShfX2dldFByb3RvT2YobW9kKSkgOiB7fSwgX19jb3B5UHJvcHMoXG4gIC8vIElmIHRoZSBpbXBvcnRlciBpcyBpbiBub2RlIGNvbXBhdGliaWxpdHkgbW9kZSBvciB0aGlzIGlzIG5vdCBhbiBFU01cbiAgLy8gZmlsZSB0aGF0IGhhcyBiZWVuIGNvbnZlcnRlZCB0byBhIENvbW1vbkpTIGZpbGUgdXNpbmcgYSBCYWJlbC1cbiAgLy8gY29tcGF0aWJsZSB0cmFuc2Zvcm0gKGkuZS4gXCJfX2VzTW9kdWxlXCIgaGFzIG5vdCBiZWVuIHNldCksIHRoZW4gc2V0XG4gIC8vIFwiZGVmYXVsdFwiIHRvIHRoZSBDb21tb25KUyBcIm1vZHVsZS5leHBvcnRzXCIgZm9yIG5vZGUgY29tcGF0aWJpbGl0eS5cbiAgaXNOb2RlTW9kZSB8fCAhbW9kIHx8ICFtb2QuX19lc01vZHVsZSA/IF9fZGVmUHJvcCh0YXJnZXQsIFwiZGVmYXVsdFwiLCB7IHZhbHVlOiBtb2QsIGVudW1lcmFibGU6IHRydWUgfSkgOiB0YXJnZXQsXG4gIG1vZFxuKSk7XG5cbi8vIG5vZGVfbW9kdWxlcy9zZXQtY29va2llLXBhcnNlci9saWIvc2V0LWNvb2tpZS5qc1xudmFyIHJlcXVpcmVfc2V0X2Nvb2tpZSA9IF9fY29tbW9uSlMoe1xuICBcIm5vZGVfbW9kdWxlcy9zZXQtY29va2llLXBhcnNlci9saWIvc2V0LWNvb2tpZS5qc1wiKGV4cG9ydHMsIG1vZHVsZSkge1xuICAgIFwidXNlIHN0cmljdFwiO1xuICAgIHZhciBkZWZhdWx0UGFyc2VPcHRpb25zID0ge1xuICAgICAgZGVjb2RlVmFsdWVzOiB0cnVlLFxuICAgICAgbWFwOiBmYWxzZSxcbiAgICAgIHNpbGVudDogZmFsc2VcbiAgICB9O1xuICAgIGZ1bmN0aW9uIGlzTm9uRW1wdHlTdHJpbmcoc3RyKSB7XG4gICAgICByZXR1cm4gdHlwZW9mIHN0ciA9PT0gXCJzdHJpbmdcIiAmJiAhIXN0ci50cmltKCk7XG4gICAgfVxuICAgIGZ1bmN0aW9uIHBhcnNlU3RyaW5nKHNldENvb2tpZVZhbHVlLCBvcHRpb25zKSB7XG4gICAgICB2YXIgcGFydHMgPSBzZXRDb29raWVWYWx1ZS5zcGxpdChcIjtcIikuZmlsdGVyKGlzTm9uRW1wdHlTdHJpbmcpO1xuICAgICAgdmFyIG5hbWVWYWx1ZVBhaXJTdHIgPSBwYXJ0cy5zaGlmdCgpO1xuICAgICAgdmFyIHBhcnNlZCA9IHBhcnNlTmFtZVZhbHVlUGFpcihuYW1lVmFsdWVQYWlyU3RyKTtcbiAgICAgIHZhciBuYW1lID0gcGFyc2VkLm5hbWU7XG4gICAgICB2YXIgdmFsdWUgPSBwYXJzZWQudmFsdWU7XG4gICAgICBvcHRpb25zID0gb3B0aW9ucyA/IE9iamVjdC5hc3NpZ24oe30sIGRlZmF1bHRQYXJzZU9wdGlvbnMsIG9wdGlvbnMpIDogZGVmYXVsdFBhcnNlT3B0aW9ucztcbiAgICAgIHRyeSB7XG4gICAgICAgIHZhbHVlID0gb3B0aW9ucy5kZWNvZGVWYWx1ZXMgPyBkZWNvZGVVUklDb21wb25lbnQodmFsdWUpIDogdmFsdWU7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgICAgXCJzZXQtY29va2llLXBhcnNlciBlbmNvdW50ZXJlZCBhbiBlcnJvciB3aGlsZSBkZWNvZGluZyBhIGNvb2tpZSB3aXRoIHZhbHVlICdcIiArIHZhbHVlICsgXCInLiBTZXQgb3B0aW9ucy5kZWNvZGVWYWx1ZXMgdG8gZmFsc2UgdG8gZGlzYWJsZSB0aGlzIGZlYXR1cmUuXCIsXG4gICAgICAgICAgZVxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgdmFyIGNvb2tpZSA9IHtcbiAgICAgICAgbmFtZSxcbiAgICAgICAgdmFsdWVcbiAgICAgIH07XG4gICAgICBwYXJ0cy5mb3JFYWNoKGZ1bmN0aW9uKHBhcnQpIHtcbiAgICAgICAgdmFyIHNpZGVzID0gcGFydC5zcGxpdChcIj1cIik7XG4gICAgICAgIHZhciBrZXkgPSBzaWRlcy5zaGlmdCgpLnRyaW1MZWZ0KCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgdmFyIHZhbHVlMiA9IHNpZGVzLmpvaW4oXCI9XCIpO1xuICAgICAgICBpZiAoa2V5ID09PSBcImV4cGlyZXNcIikge1xuICAgICAgICAgIGNvb2tpZS5leHBpcmVzID0gbmV3IERhdGUodmFsdWUyKTtcbiAgICAgICAgfSBlbHNlIGlmIChrZXkgPT09IFwibWF4LWFnZVwiKSB7XG4gICAgICAgICAgY29va2llLm1heEFnZSA9IHBhcnNlSW50KHZhbHVlMiwgMTApO1xuICAgICAgICB9IGVsc2UgaWYgKGtleSA9PT0gXCJzZWN1cmVcIikge1xuICAgICAgICAgIGNvb2tpZS5zZWN1cmUgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKGtleSA9PT0gXCJodHRwb25seVwiKSB7XG4gICAgICAgICAgY29va2llLmh0dHBPbmx5ID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmIChrZXkgPT09IFwic2FtZXNpdGVcIikge1xuICAgICAgICAgIGNvb2tpZS5zYW1lU2l0ZSA9IHZhbHVlMjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb29raWVba2V5XSA9IHZhbHVlMjtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm4gY29va2llO1xuICAgIH1cbiAgICBmdW5jdGlvbiBwYXJzZU5hbWVWYWx1ZVBhaXIobmFtZVZhbHVlUGFpclN0cikge1xuICAgICAgdmFyIG5hbWUgPSBcIlwiO1xuICAgICAgdmFyIHZhbHVlID0gXCJcIjtcbiAgICAgIHZhciBuYW1lVmFsdWVBcnIgPSBuYW1lVmFsdWVQYWlyU3RyLnNwbGl0KFwiPVwiKTtcbiAgICAgIGlmIChuYW1lVmFsdWVBcnIubGVuZ3RoID4gMSkge1xuICAgICAgICBuYW1lID0gbmFtZVZhbHVlQXJyLnNoaWZ0KCk7XG4gICAgICAgIHZhbHVlID0gbmFtZVZhbHVlQXJyLmpvaW4oXCI9XCIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFsdWUgPSBuYW1lVmFsdWVQYWlyU3RyO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHsgbmFtZSwgdmFsdWUgfTtcbiAgICB9XG4gICAgZnVuY3Rpb24gcGFyc2UoaW5wdXQsIG9wdGlvbnMpIHtcbiAgICAgIG9wdGlvbnMgPSBvcHRpb25zID8gT2JqZWN0LmFzc2lnbih7fSwgZGVmYXVsdFBhcnNlT3B0aW9ucywgb3B0aW9ucykgOiBkZWZhdWx0UGFyc2VPcHRpb25zO1xuICAgICAgaWYgKCFpbnB1dCkge1xuICAgICAgICBpZiAoIW9wdGlvbnMubWFwKSB7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiB7fTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGlucHV0LmhlYWRlcnMpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBpbnB1dC5oZWFkZXJzLmdldFNldENvb2tpZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgaW5wdXQgPSBpbnB1dC5oZWFkZXJzLmdldFNldENvb2tpZSgpO1xuICAgICAgICB9IGVsc2UgaWYgKGlucHV0LmhlYWRlcnNbXCJzZXQtY29va2llXCJdKSB7XG4gICAgICAgICAgaW5wdXQgPSBpbnB1dC5oZWFkZXJzW1wic2V0LWNvb2tpZVwiXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB2YXIgc2NoID0gaW5wdXQuaGVhZGVyc1tPYmplY3Qua2V5cyhpbnB1dC5oZWFkZXJzKS5maW5kKGZ1bmN0aW9uKGtleSkge1xuICAgICAgICAgICAgcmV0dXJuIGtleS50b0xvd2VyQ2FzZSgpID09PSBcInNldC1jb29raWVcIjtcbiAgICAgICAgICB9KV07XG4gICAgICAgICAgaWYgKCFzY2ggJiYgaW5wdXQuaGVhZGVycy5jb29raWUgJiYgIW9wdGlvbnMuc2lsZW50KSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgICAgICAgIFwiV2FybmluZzogc2V0LWNvb2tpZS1wYXJzZXIgYXBwZWFycyB0byBoYXZlIGJlZW4gY2FsbGVkIG9uIGEgcmVxdWVzdCBvYmplY3QuIEl0IGlzIGRlc2lnbmVkIHRvIHBhcnNlIFNldC1Db29raWUgaGVhZGVycyBmcm9tIHJlc3BvbnNlcywgbm90IENvb2tpZSBoZWFkZXJzIGZyb20gcmVxdWVzdHMuIFNldCB0aGUgb3B0aW9uIHtzaWxlbnQ6IHRydWV9IHRvIHN1cHByZXNzIHRoaXMgd2FybmluZy5cIlxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaW5wdXQgPSBzY2g7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShpbnB1dCkpIHtcbiAgICAgICAgaW5wdXQgPSBbaW5wdXRdO1xuICAgICAgfVxuICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgPyBPYmplY3QuYXNzaWduKHt9LCBkZWZhdWx0UGFyc2VPcHRpb25zLCBvcHRpb25zKSA6IGRlZmF1bHRQYXJzZU9wdGlvbnM7XG4gICAgICBpZiAoIW9wdGlvbnMubWFwKSB7XG4gICAgICAgIHJldHVybiBpbnB1dC5maWx0ZXIoaXNOb25FbXB0eVN0cmluZykubWFwKGZ1bmN0aW9uKHN0cikge1xuICAgICAgICAgIHJldHVybiBwYXJzZVN0cmluZyhzdHIsIG9wdGlvbnMpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBjb29raWVzID0ge307XG4gICAgICAgIHJldHVybiBpbnB1dC5maWx0ZXIoaXNOb25FbXB0eVN0cmluZykucmVkdWNlKGZ1bmN0aW9uKGNvb2tpZXMyLCBzdHIpIHtcbiAgICAgICAgICB2YXIgY29va2llID0gcGFyc2VTdHJpbmcoc3RyLCBvcHRpb25zKTtcbiAgICAgICAgICBjb29raWVzMltjb29raWUubmFtZV0gPSBjb29raWU7XG4gICAgICAgICAgcmV0dXJuIGNvb2tpZXMyO1xuICAgICAgICB9LCBjb29raWVzKTtcbiAgICAgIH1cbiAgICB9XG4gICAgZnVuY3Rpb24gc3BsaXRDb29raWVzU3RyaW5nMihjb29raWVzU3RyaW5nKSB7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShjb29raWVzU3RyaW5nKSkge1xuICAgICAgICByZXR1cm4gY29va2llc1N0cmluZztcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgY29va2llc1N0cmluZyAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG4gICAgICB2YXIgY29va2llc1N0cmluZ3MgPSBbXTtcbiAgICAgIHZhciBwb3MgPSAwO1xuICAgICAgdmFyIHN0YXJ0O1xuICAgICAgdmFyIGNoO1xuICAgICAgdmFyIGxhc3RDb21tYTtcbiAgICAgIHZhciBuZXh0U3RhcnQ7XG4gICAgICB2YXIgY29va2llc1NlcGFyYXRvckZvdW5kO1xuICAgICAgZnVuY3Rpb24gc2tpcFdoaXRlc3BhY2UoKSB7XG4gICAgICAgIHdoaWxlIChwb3MgPCBjb29raWVzU3RyaW5nLmxlbmd0aCAmJiAvXFxzLy50ZXN0KGNvb2tpZXNTdHJpbmcuY2hhckF0KHBvcykpKSB7XG4gICAgICAgICAgcG9zICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHBvcyA8IGNvb2tpZXNTdHJpbmcubGVuZ3RoO1xuICAgICAgfVxuICAgICAgZnVuY3Rpb24gbm90U3BlY2lhbENoYXIoKSB7XG4gICAgICAgIGNoID0gY29va2llc1N0cmluZy5jaGFyQXQocG9zKTtcbiAgICAgICAgcmV0dXJuIGNoICE9PSBcIj1cIiAmJiBjaCAhPT0gXCI7XCIgJiYgY2ggIT09IFwiLFwiO1xuICAgICAgfVxuICAgICAgd2hpbGUgKHBvcyA8IGNvb2tpZXNTdHJpbmcubGVuZ3RoKSB7XG4gICAgICAgIHN0YXJ0ID0gcG9zO1xuICAgICAgICBjb29raWVzU2VwYXJhdG9yRm91bmQgPSBmYWxzZTtcbiAgICAgICAgd2hpbGUgKHNraXBXaGl0ZXNwYWNlKCkpIHtcbiAgICAgICAgICBjaCA9IGNvb2tpZXNTdHJpbmcuY2hhckF0KHBvcyk7XG4gICAgICAgICAgaWYgKGNoID09PSBcIixcIikge1xuICAgICAgICAgICAgbGFzdENvbW1hID0gcG9zO1xuICAgICAgICAgICAgcG9zICs9IDE7XG4gICAgICAgICAgICBza2lwV2hpdGVzcGFjZSgpO1xuICAgICAgICAgICAgbmV4dFN0YXJ0ID0gcG9zO1xuICAgICAgICAgICAgd2hpbGUgKHBvcyA8IGNvb2tpZXNTdHJpbmcubGVuZ3RoICYmIG5vdFNwZWNpYWxDaGFyKCkpIHtcbiAgICAgICAgICAgICAgcG9zICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocG9zIDwgY29va2llc1N0cmluZy5sZW5ndGggJiYgY29va2llc1N0cmluZy5jaGFyQXQocG9zKSA9PT0gXCI9XCIpIHtcbiAgICAgICAgICAgICAgY29va2llc1NlcGFyYXRvckZvdW5kID0gdHJ1ZTtcbiAgICAgICAgICAgICAgcG9zID0gbmV4dFN0YXJ0O1xuICAgICAgICAgICAgICBjb29raWVzU3RyaW5ncy5wdXNoKGNvb2tpZXNTdHJpbmcuc3Vic3RyaW5nKHN0YXJ0LCBsYXN0Q29tbWEpKTtcbiAgICAgICAgICAgICAgc3RhcnQgPSBwb3M7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBwb3MgPSBsYXN0Q29tbWEgKyAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBwb3MgKz0gMTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFjb29raWVzU2VwYXJhdG9yRm91bmQgfHwgcG9zID49IGNvb2tpZXNTdHJpbmcubGVuZ3RoKSB7XG4gICAgICAgICAgY29va2llc1N0cmluZ3MucHVzaChjb29raWVzU3RyaW5nLnN1YnN0cmluZyhzdGFydCwgY29va2llc1N0cmluZy5sZW5ndGgpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIGNvb2tpZXNTdHJpbmdzO1xuICAgIH1cbiAgICBtb2R1bGUuZXhwb3J0cyA9IHBhcnNlO1xuICAgIG1vZHVsZS5leHBvcnRzLnBhcnNlID0gcGFyc2U7XG4gICAgbW9kdWxlLmV4cG9ydHMucGFyc2VTdHJpbmcgPSBwYXJzZVN0cmluZztcbiAgICBtb2R1bGUuZXhwb3J0cy5zcGxpdENvb2tpZXNTdHJpbmcgPSBzcGxpdENvb2tpZXNTdHJpbmcyO1xuICB9XG59KTtcblxuLy8gc3JjL0hlYWRlcnMudHNcbnZhciBpbXBvcnRfc2V0X2Nvb2tpZV9wYXJzZXIgPSBfX3RvRVNNKHJlcXVpcmVfc2V0X2Nvb2tpZSgpKTtcblxuLy8gc3JjL3V0aWxzL25vcm1hbGl6ZUhlYWRlck5hbWUudHNcbnZhciBIRUFERVJTX0lOVkFMSURfQ0hBUkFDVEVSUyA9IC9bXmEtejAtOVxcLSMkJSYnKisuXl9gfH5dL2k7XG5mdW5jdGlvbiBub3JtYWxpemVIZWFkZXJOYW1lKG5hbWUpIHtcbiAgaWYgKEhFQURFUlNfSU5WQUxJRF9DSEFSQUNURVJTLnRlc3QobmFtZSkgfHwgbmFtZS50cmltKCkgPT09IFwiXCIpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiSW52YWxpZCBjaGFyYWN0ZXIgaW4gaGVhZGVyIGZpZWxkIG5hbWVcIik7XG4gIH1cbiAgcmV0dXJuIG5hbWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG59XG5cbi8vIHNyYy91dGlscy9ub3JtYWxpemVIZWFkZXJWYWx1ZS50c1xudmFyIGNoYXJDb2Rlc1RvUmVtb3ZlID0gW1xuICBTdHJpbmcuZnJvbUNoYXJDb2RlKDEwKSxcbiAgU3RyaW5nLmZyb21DaGFyQ29kZSgxMyksXG4gIFN0cmluZy5mcm9tQ2hhckNvZGUoOSksXG4gIFN0cmluZy5mcm9tQ2hhckNvZGUoMzIpXG5dO1xudmFyIEhFQURFUl9WQUxVRV9SRU1PVkVfUkVHRVhQID0gbmV3IFJlZ0V4cChcbiAgYCheWyR7Y2hhckNvZGVzVG9SZW1vdmUuam9pbihcIlwiKX1dfCRbJHtjaGFyQ29kZXNUb1JlbW92ZS5qb2luKFwiXCIpfV0pYCxcbiAgXCJnXCJcbik7XG5mdW5jdGlvbiBub3JtYWxpemVIZWFkZXJWYWx1ZSh2YWx1ZSkge1xuICBjb25zdCBuZXh0VmFsdWUgPSB2YWx1ZS5yZXBsYWNlKEhFQURFUl9WQUxVRV9SRU1PVkVfUkVHRVhQLCBcIlwiKTtcbiAgcmV0dXJuIG5leHRWYWx1ZTtcbn1cblxuLy8gc3JjL3V0aWxzL2lzVmFsaWRIZWFkZXJOYW1lLnRzXG5mdW5jdGlvbiBpc1ZhbGlkSGVhZGVyTmFtZSh2YWx1ZSkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmICh2YWx1ZS5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB2YWx1ZS5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoYXJhY3RlciA9IHZhbHVlLmNoYXJDb2RlQXQoaSk7XG4gICAgaWYgKGNoYXJhY3RlciA+IDEyNyB8fCAhaXNUb2tlbihjaGFyYWN0ZXIpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG4gIHJldHVybiB0cnVlO1xufVxuZnVuY3Rpb24gaXNUb2tlbih2YWx1ZSkge1xuICByZXR1cm4gIVtcbiAgICAxMjcsXG4gICAgMzIsXG4gICAgXCIoXCIsXG4gICAgXCIpXCIsXG4gICAgXCI8XCIsXG4gICAgXCI+XCIsXG4gICAgXCJAXCIsXG4gICAgXCIsXCIsXG4gICAgXCI7XCIsXG4gICAgXCI6XCIsXG4gICAgXCJcXFxcXCIsXG4gICAgJ1wiJyxcbiAgICBcIi9cIixcbiAgICBcIltcIixcbiAgICBcIl1cIixcbiAgICBcIj9cIixcbiAgICBcIj1cIixcbiAgICBcIntcIixcbiAgICBcIn1cIlxuICBdLmluY2x1ZGVzKHZhbHVlKTtcbn1cblxuLy8gc3JjL3V0aWxzL2lzVmFsaWRIZWFkZXJWYWx1ZS50c1xuZnVuY3Rpb24gaXNWYWxpZEhlYWRlclZhbHVlKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKHZhbHVlLnRyaW0oKSAhPT0gdmFsdWUpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB2YWx1ZS5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoYXJhY3RlciA9IHZhbHVlLmNoYXJDb2RlQXQoaSk7XG4gICAgaWYgKFxuICAgICAgLy8gTlVMLlxuICAgICAgY2hhcmFjdGVyID09PSAwIHx8IC8vIEhUVFAgbmV3bGluZSBieXRlcy5cbiAgICAgIGNoYXJhY3RlciA9PT0gMTAgfHwgY2hhcmFjdGVyID09PSAxM1xuICAgICkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gc3JjL0hlYWRlcnMudHNcbnZhciBOT1JNQUxJWkVEX0hFQURFUlMgPSBTeW1ib2woXCJub3JtYWxpemVkSGVhZGVyc1wiKTtcbnZhciBSQVdfSEVBREVSX05BTUVTID0gU3ltYm9sKFwicmF3SGVhZGVyTmFtZXNcIik7XG52YXIgSEVBREVSX1ZBTFVFX0RFTElNSVRFUiA9IFwiLCBcIjtcbnZhciBfYSwgX2IsIF9jO1xudmFyIEhlYWRlcnMgPSBjbGFzcyBfSGVhZGVycyB7XG4gIGNvbnN0cnVjdG9yKGluaXQpIHtcbiAgICAvLyBOb3JtYWxpemVkIGhlYWRlciB7XCJuYW1lXCI6XCJhLCBiXCJ9IHN0b3JhZ2UuXG4gICAgdGhpc1tfYV0gPSB7fTtcbiAgICAvLyBLZWVwcyB0aGUgbWFwcGluZyBiZXR3ZWVuIHRoZSByYXcgaGVhZGVyIG5hbWVcbiAgICAvLyBhbmQgdGhlIG5vcm1hbGl6ZWQgaGVhZGVyIG5hbWUgdG8gZWFzZSB0aGUgbG9va3VwLlxuICAgIHRoaXNbX2JdID0gLyogQF9fUFVSRV9fICovIG5ldyBNYXAoKTtcbiAgICB0aGlzW19jXSA9IFwiSGVhZGVyc1wiO1xuICAgIGlmIChbXCJIZWFkZXJzXCIsIFwiSGVhZGVyc1BvbHlmaWxsXCJdLmluY2x1ZGVzKGluaXQ/LmNvbnN0cnVjdG9yLm5hbWUpIHx8IGluaXQgaW5zdGFuY2VvZiBfSGVhZGVycyB8fCB0eXBlb2YgZ2xvYmFsVGhpcy5IZWFkZXJzICE9PSBcInVuZGVmaW5lZFwiICYmIGluaXQgaW5zdGFuY2VvZiBnbG9iYWxUaGlzLkhlYWRlcnMpIHtcbiAgICAgIGNvbnN0IGluaXRpYWxIZWFkZXJzID0gaW5pdDtcbiAgICAgIGluaXRpYWxIZWFkZXJzLmZvckVhY2goKHZhbHVlLCBuYW1lKSA9PiB7XG4gICAgICAgIHRoaXMuYXBwZW5kKG5hbWUsIHZhbHVlKTtcbiAgICAgIH0sIHRoaXMpO1xuICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShpbml0KSkge1xuICAgICAgaW5pdC5mb3JFYWNoKChbbmFtZSwgdmFsdWVdKSA9PiB7XG4gICAgICAgIHRoaXMuYXBwZW5kKFxuICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZS5qb2luKEhFQURFUl9WQUxVRV9ERUxJTUlURVIpIDogdmFsdWVcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAoaW5pdCkge1xuICAgICAgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoaW5pdCkuZm9yRWFjaCgobmFtZSkgPT4ge1xuICAgICAgICBjb25zdCB2YWx1ZSA9IGluaXRbbmFtZV07XG4gICAgICAgIHRoaXMuYXBwZW5kKFxuICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZS5qb2luKEhFQURFUl9WQUxVRV9ERUxJTUlURVIpIDogdmFsdWVcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICBbKF9hID0gTk9STUFMSVpFRF9IRUFERVJTLCBfYiA9IFJBV19IRUFERVJfTkFNRVMsIF9jID0gU3ltYm9sLnRvU3RyaW5nVGFnLCBTeW1ib2wuaXRlcmF0b3IpXSgpIHtcbiAgICByZXR1cm4gdGhpcy5lbnRyaWVzKCk7XG4gIH1cbiAgKmtleXMoKSB7XG4gICAgZm9yIChjb25zdCBbbmFtZV0gb2YgdGhpcy5lbnRyaWVzKCkpIHtcbiAgICAgIHlpZWxkIG5hbWU7XG4gICAgfVxuICB9XG4gICp2YWx1ZXMoKSB7XG4gICAgZm9yIChjb25zdCBbLCB2YWx1ZV0gb2YgdGhpcy5lbnRyaWVzKCkpIHtcbiAgICAgIHlpZWxkIHZhbHVlO1xuICAgIH1cbiAgfVxuICAqZW50cmllcygpIHtcbiAgICBsZXQgc29ydGVkS2V5cyA9IE9iamVjdC5rZXlzKHRoaXNbTk9STUFMSVpFRF9IRUFERVJTXSkuc29ydChcbiAgICAgIChhLCBiKSA9PiBhLmxvY2FsZUNvbXBhcmUoYilcbiAgICApO1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiBzb3J0ZWRLZXlzKSB7XG4gICAgICBpZiAobmFtZSA9PT0gXCJzZXQtY29va2llXCIpIHtcbiAgICAgICAgZm9yIChjb25zdCB2YWx1ZSBvZiB0aGlzLmdldFNldENvb2tpZSgpKSB7XG4gICAgICAgICAgeWllbGQgW25hbWUsIHZhbHVlXTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgeWllbGQgW25hbWUsIHRoaXMuZ2V0KG5hbWUpXTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgLyoqXG4gICAqIFJldHVybnMgYSBib29sZWFuIHN0YXRpbmcgd2hldGhlciBhIGBIZWFkZXJzYCBvYmplY3QgY29udGFpbnMgYSBjZXJ0YWluIGhlYWRlci5cbiAgICovXG4gIGhhcyhuYW1lKSB7XG4gICAgaWYgKCFpc1ZhbGlkSGVhZGVyTmFtZShuYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCBoZWFkZXIgbmFtZSBcIiR7bmFtZX1cImApO1xuICAgIH1cbiAgICByZXR1cm4gdGhpc1tOT1JNQUxJWkVEX0hFQURFUlNdLmhhc093blByb3BlcnR5KG5vcm1hbGl6ZUhlYWRlck5hbWUobmFtZSkpO1xuICB9XG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgYEJ5dGVTdHJpbmdgIHNlcXVlbmNlIG9mIGFsbCB0aGUgdmFsdWVzIG9mIGEgaGVhZGVyIHdpdGggYSBnaXZlbiBuYW1lLlxuICAgKi9cbiAgZ2V0KG5hbWUpIHtcbiAgICBpZiAoIWlzVmFsaWRIZWFkZXJOYW1lKG5hbWUpKSB7XG4gICAgICB0aHJvdyBUeXBlRXJyb3IoYEludmFsaWQgaGVhZGVyIG5hbWUgXCIke25hbWV9XCJgKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXNbTk9STUFMSVpFRF9IRUFERVJTXVtub3JtYWxpemVIZWFkZXJOYW1lKG5hbWUpXSA/PyBudWxsO1xuICB9XG4gIC8qKlxuICAgKiBTZXRzIGEgbmV3IHZhbHVlIGZvciBhbiBleGlzdGluZyBoZWFkZXIgaW5zaWRlIGEgYEhlYWRlcnNgIG9iamVjdCwgb3IgYWRkcyB0aGUgaGVhZGVyIGlmIGl0IGRvZXMgbm90IGFscmVhZHkgZXhpc3QuXG4gICAqL1xuICBzZXQobmFtZSwgdmFsdWUpIHtcbiAgICBpZiAoIWlzVmFsaWRIZWFkZXJOYW1lKG5hbWUpIHx8ICFpc1ZhbGlkSGVhZGVyVmFsdWUodmFsdWUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IG5vcm1hbGl6ZWROYW1lID0gbm9ybWFsaXplSGVhZGVyTmFtZShuYW1lKTtcbiAgICBjb25zdCBub3JtYWxpemVkVmFsdWUgPSBub3JtYWxpemVIZWFkZXJWYWx1ZSh2YWx1ZSk7XG4gICAgdGhpc1tOT1JNQUxJWkVEX0hFQURFUlNdW25vcm1hbGl6ZWROYW1lXSA9IG5vcm1hbGl6ZUhlYWRlclZhbHVlKG5vcm1hbGl6ZWRWYWx1ZSk7XG4gICAgdGhpc1tSQVdfSEVBREVSX05BTUVTXS5zZXQobm9ybWFsaXplZE5hbWUsIG5hbWUpO1xuICB9XG4gIC8qKlxuICAgKiBBcHBlbmRzIGEgbmV3IHZhbHVlIG9udG8gYW4gZXhpc3RpbmcgaGVhZGVyIGluc2lkZSBhIGBIZWFkZXJzYCBvYmplY3QsIG9yIGFkZHMgdGhlIGhlYWRlciBpZiBpdCBkb2VzIG5vdCBhbHJlYWR5IGV4aXN0LlxuICAgKi9cbiAgYXBwZW5kKG5hbWUsIHZhbHVlKSB7XG4gICAgaWYgKCFpc1ZhbGlkSGVhZGVyTmFtZShuYW1lKSB8fCAhaXNWYWxpZEhlYWRlclZhbHVlKHZhbHVlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBub3JtYWxpemVkTmFtZSA9IG5vcm1hbGl6ZUhlYWRlck5hbWUobmFtZSk7XG4gICAgY29uc3Qgbm9ybWFsaXplZFZhbHVlID0gbm9ybWFsaXplSGVhZGVyVmFsdWUodmFsdWUpO1xuICAgIGxldCByZXNvbHZlZFZhbHVlID0gdGhpcy5oYXMobm9ybWFsaXplZE5hbWUpID8gYCR7dGhpcy5nZXQobm9ybWFsaXplZE5hbWUpfSwgJHtub3JtYWxpemVkVmFsdWV9YCA6IG5vcm1hbGl6ZWRWYWx1ZTtcbiAgICB0aGlzLnNldChuYW1lLCByZXNvbHZlZFZhbHVlKTtcbiAgfVxuICAvKipcbiAgICogRGVsZXRlcyBhIGhlYWRlciBmcm9tIHRoZSBgSGVhZGVyc2Agb2JqZWN0LlxuICAgKi9cbiAgZGVsZXRlKG5hbWUpIHtcbiAgICBpZiAoIWlzVmFsaWRIZWFkZXJOYW1lKG5hbWUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghdGhpcy5oYXMobmFtZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgbm9ybWFsaXplZE5hbWUgPSBub3JtYWxpemVIZWFkZXJOYW1lKG5hbWUpO1xuICAgIGRlbGV0ZSB0aGlzW05PUk1BTElaRURfSEVBREVSU11bbm9ybWFsaXplZE5hbWVdO1xuICAgIHRoaXNbUkFXX0hFQURFUl9OQU1FU10uZGVsZXRlKG5vcm1hbGl6ZWROYW1lKTtcbiAgfVxuICAvKipcbiAgICogVHJhdmVyc2VzIHRoZSBgSGVhZGVyc2Agb2JqZWN0LFxuICAgKiBjYWxsaW5nIHRoZSBnaXZlbiBjYWxsYmFjayBmb3IgZWFjaCBoZWFkZXIuXG4gICAqL1xuICBmb3JFYWNoKGNhbGxiYWNrLCB0aGlzQXJnKSB7XG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIHRoaXMuZW50cmllcygpKSB7XG4gICAgICBjYWxsYmFjay5jYWxsKHRoaXNBcmcsIHZhbHVlLCBuYW1lLCB0aGlzKTtcbiAgICB9XG4gIH1cbiAgLyoqXG4gICAqIFJldHVybnMgYW4gYXJyYXkgY29udGFpbmluZyB0aGUgdmFsdWVzXG4gICAqIG9mIGFsbCBTZXQtQ29va2llIGhlYWRlcnMgYXNzb2NpYXRlZFxuICAgKiB3aXRoIGEgcmVzcG9uc2VcbiAgICovXG4gIGdldFNldENvb2tpZSgpIHtcbiAgICBjb25zdCBzZXRDb29raWVIZWFkZXIgPSB0aGlzLmdldChcInNldC1jb29raWVcIik7XG4gICAgaWYgKHNldENvb2tpZUhlYWRlciA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgICBpZiAoc2V0Q29va2llSGVhZGVyID09PSBcIlwiKSB7XG4gICAgICByZXR1cm4gW1wiXCJdO1xuICAgIH1cbiAgICByZXR1cm4gKDAsIGltcG9ydF9zZXRfY29va2llX3BhcnNlci5zcGxpdENvb2tpZXNTdHJpbmcpKHNldENvb2tpZUhlYWRlcik7XG4gIH1cbn07XG5cbi8vIHNyYy9nZXRSYXdIZWFkZXJzLnRzXG5mdW5jdGlvbiBnZXRSYXdIZWFkZXJzKGhlYWRlcnMpIHtcbiAgY29uc3QgcmF3SGVhZGVycyA9IHt9O1xuICBmb3IgKGNvbnN0IFtuYW1lLCB2YWx1ZV0gb2YgaGVhZGVycy5lbnRyaWVzKCkpIHtcbiAgICByYXdIZWFkZXJzW2hlYWRlcnNbUkFXX0hFQURFUl9OQU1FU10uZ2V0KG5hbWUpXSA9IHZhbHVlO1xuICB9XG4gIHJldHVybiByYXdIZWFkZXJzO1xufVxuXG4vLyBzcmMvdHJhbnNmb3JtZXJzL2hlYWRlcnNUb0xpc3QudHNcbmZ1bmN0aW9uIGhlYWRlcnNUb0xpc3QoaGVhZGVycykge1xuICBjb25zdCBoZWFkZXJzTGlzdCA9IFtdO1xuICBoZWFkZXJzLmZvckVhY2goKHZhbHVlLCBuYW1lKSA9PiB7XG4gICAgY29uc3QgcmVzb2x2ZWRWYWx1ZSA9IHZhbHVlLmluY2x1ZGVzKFwiLFwiKSA/IHZhbHVlLnNwbGl0KFwiLFwiKS5tYXAoKHZhbHVlMikgPT4gdmFsdWUyLnRyaW0oKSkgOiB2YWx1ZTtcbiAgICBoZWFkZXJzTGlzdC5wdXNoKFtuYW1lLCByZXNvbHZlZFZhbHVlXSk7XG4gIH0pO1xuICByZXR1cm4gaGVhZGVyc0xpc3Q7XG59XG5cbi8vIHNyYy90cmFuc2Zvcm1lcnMvaGVhZGVyc1RvU3RyaW5nLnRzXG5mdW5jdGlvbiBoZWFkZXJzVG9TdHJpbmcoaGVhZGVycykge1xuICBjb25zdCBsaXN0ID0gaGVhZGVyc1RvTGlzdChoZWFkZXJzKTtcbiAgY29uc3QgbGluZXMgPSBsaXN0Lm1hcCgoW25hbWUsIHZhbHVlXSkgPT4ge1xuICAgIGNvbnN0IHZhbHVlcyA9IFtdLmNvbmNhdCh2YWx1ZSk7XG4gICAgcmV0dXJuIGAke25hbWV9OiAke3ZhbHVlcy5qb2luKFwiLCBcIil9YDtcbiAgfSk7XG4gIHJldHVybiBsaW5lcy5qb2luKFwiXFxyXFxuXCIpO1xufVxuXG4vLyBzcmMvdHJhbnNmb3JtZXJzL2hlYWRlcnNUb09iamVjdC50c1xudmFyIHNpbmdsZVZhbHVlSGVhZGVycyA9IFtcInVzZXItYWdlbnRcIl07XG5mdW5jdGlvbiBoZWFkZXJzVG9PYmplY3QoaGVhZGVycykge1xuICBjb25zdCBoZWFkZXJzT2JqZWN0ID0ge307XG4gIGhlYWRlcnMuZm9yRWFjaCgodmFsdWUsIG5hbWUpID0+IHtcbiAgICBjb25zdCBpc011bHRpVmFsdWUgPSAhc2luZ2xlVmFsdWVIZWFkZXJzLmluY2x1ZGVzKG5hbWUudG9Mb3dlckNhc2UoKSkgJiYgdmFsdWUuaW5jbHVkZXMoXCIsXCIpO1xuICAgIGhlYWRlcnNPYmplY3RbbmFtZV0gPSBpc011bHRpVmFsdWUgPyB2YWx1ZS5zcGxpdChcIixcIikubWFwKChzKSA9PiBzLnRyaW0oKSkgOiB2YWx1ZTtcbiAgfSk7XG4gIHJldHVybiBoZWFkZXJzT2JqZWN0O1xufVxuXG4vLyBzcmMvdHJhbnNmb3JtZXJzL3N0cmluZ1RvSGVhZGVycy50c1xuZnVuY3Rpb24gc3RyaW5nVG9IZWFkZXJzKHN0cikge1xuICBjb25zdCBsaW5lcyA9IHN0ci50cmltKCkuc3BsaXQoL1tcXHJcXG5dKy8pO1xuICByZXR1cm4gbGluZXMucmVkdWNlKChoZWFkZXJzLCBsaW5lKSA9PiB7XG4gICAgaWYgKGxpbmUudHJpbSgpID09PSBcIlwiKSB7XG4gICAgICByZXR1cm4gaGVhZGVycztcbiAgICB9XG4gICAgY29uc3QgcGFydHMgPSBsaW5lLnNwbGl0KFwiOiBcIik7XG4gICAgY29uc3QgbmFtZSA9IHBhcnRzLnNoaWZ0KCk7XG4gICAgY29uc3QgdmFsdWUgPSBwYXJ0cy5qb2luKFwiOiBcIik7XG4gICAgaGVhZGVycy5hcHBlbmQobmFtZSwgdmFsdWUpO1xuICAgIHJldHVybiBoZWFkZXJzO1xuICB9LCBuZXcgSGVhZGVycygpKTtcbn1cblxuLy8gc3JjL3RyYW5zZm9ybWVycy9saXN0VG9IZWFkZXJzLnRzXG5mdW5jdGlvbiBsaXN0VG9IZWFkZXJzKGxpc3QpIHtcbiAgY29uc3QgaGVhZGVycyA9IG5ldyBIZWFkZXJzKCk7XG4gIGxpc3QuZm9yRWFjaCgoW25hbWUsIHZhbHVlXSkgPT4ge1xuICAgIGNvbnN0IHZhbHVlcyA9IFtdLmNvbmNhdCh2YWx1ZSk7XG4gICAgdmFsdWVzLmZvckVhY2goKHZhbHVlMikgPT4ge1xuICAgICAgaGVhZGVycy5hcHBlbmQobmFtZSwgdmFsdWUyKTtcbiAgICB9KTtcbiAgfSk7XG4gIHJldHVybiBoZWFkZXJzO1xufVxuXG4vLyBzcmMvdHJhbnNmb3JtZXJzL3JlZHVjZUhlYWRlcnNPYmplY3QudHNcbmZ1bmN0aW9uIHJlZHVjZUhlYWRlcnNPYmplY3QoaGVhZGVycywgcmVkdWNlciwgaW5pdGlhbFN0YXRlKSB7XG4gIHJldHVybiBPYmplY3Qua2V5cyhoZWFkZXJzKS5yZWR1Y2UoKG5leHRIZWFkZXJzLCBuYW1lKSA9PiB7XG4gICAgcmV0dXJuIHJlZHVjZXIobmV4dEhlYWRlcnMsIG5hbWUsIGhlYWRlcnNbbmFtZV0pO1xuICB9LCBpbml0aWFsU3RhdGUpO1xufVxuXG4vLyBzcmMvdHJhbnNmb3JtZXJzL29iamVjdFRvSGVhZGVycy50c1xuZnVuY3Rpb24gb2JqZWN0VG9IZWFkZXJzKGhlYWRlcnNPYmplY3QpIHtcbiAgcmV0dXJuIHJlZHVjZUhlYWRlcnNPYmplY3QoXG4gICAgaGVhZGVyc09iamVjdCxcbiAgICAoaGVhZGVycywgbmFtZSwgdmFsdWUpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlcyA9IFtdLmNvbmNhdCh2YWx1ZSkuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgdmFsdWVzLmZvckVhY2goKHZhbHVlMikgPT4ge1xuICAgICAgICBoZWFkZXJzLmFwcGVuZChuYW1lLCB2YWx1ZTIpO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gaGVhZGVycztcbiAgICB9LFxuICAgIG5ldyBIZWFkZXJzKClcbiAgKTtcbn1cblxuLy8gc3JjL3RyYW5zZm9ybWVycy9mbGF0dGVuSGVhZGVyc0xpc3QudHNcbmZ1bmN0aW9uIGZsYXR0ZW5IZWFkZXJzTGlzdChsaXN0KSB7XG4gIHJldHVybiBsaXN0Lm1hcCgoW25hbWUsIHZhbHVlc10pID0+IHtcbiAgICByZXR1cm4gW25hbWUsIFtdLmNvbmNhdCh2YWx1ZXMpLmpvaW4oXCIsIFwiKV07XG4gIH0pO1xufVxuXG4vLyBzcmMvdHJhbnNmb3JtZXJzL2ZsYXR0ZW5IZWFkZXJzT2JqZWN0LnRzXG5mdW5jdGlvbiBmbGF0dGVuSGVhZGVyc09iamVjdChoZWFkZXJzT2JqZWN0KSB7XG4gIHJldHVybiByZWR1Y2VIZWFkZXJzT2JqZWN0KFxuICAgIGhlYWRlcnNPYmplY3QsXG4gICAgKGhlYWRlcnMsIG5hbWUsIHZhbHVlKSA9PiB7XG4gICAgICBoZWFkZXJzW25hbWVdID0gW10uY29uY2F0KHZhbHVlKS5qb2luKFwiLCBcIik7XG4gICAgICByZXR1cm4gaGVhZGVycztcbiAgICB9LFxuICAgIHt9XG4gICk7XG59XG5leHBvcnQge1xuICBIZWFkZXJzLFxuICBmbGF0dGVuSGVhZGVyc0xpc3QsXG4gIGZsYXR0ZW5IZWFkZXJzT2JqZWN0LFxuICBnZXRSYXdIZWFkZXJzLFxuICBoZWFkZXJzVG9MaXN0LFxuICBoZWFkZXJzVG9PYmplY3QsXG4gIGhlYWRlcnNUb1N0cmluZyxcbiAgbGlzdFRvSGVhZGVycyxcbiAgb2JqZWN0VG9IZWFkZXJzLFxuICByZWR1Y2VIZWFkZXJzT2JqZWN0LFxuICBzdHJpbmdUb0hlYWRlcnNcbn07XG4vLyMgc291cmNlTWFwcGluZ1VSTD1pbmRleC5tanMubWFwIiwiaW1wb3J0ICogYXMgX3N5c2NhbGxzMl8wIGZyb20gJ3NwYWNldGltZTpzeXNAMi4wJztcbmltcG9ydCB7IG1vZHVsZUhvb2tzIH0gZnJvbSAnc3BhY2V0aW1lOnN5c0AyLjAnO1xuaW1wb3J0IHsgSGVhZGVycywgaGVhZGVyc1RvTGlzdCB9IGZyb20gJ2hlYWRlcnMtcG9seWZpbGwnO1xuZXhwb3J0IHsgSGVhZGVycyB9IGZyb20gJ2hlYWRlcnMtcG9seWZpbGwnO1xuaW1wb3J0ICogYXMgX3N5c2NhbGxzMl8xIGZyb20gJ3NwYWNldGltZTpzeXNAMi4xJztcblxudHlwZW9mIGdsb2JhbFRoaXMhPT1cInVuZGVmaW5lZFwiJiYoKGdsb2JhbFRoaXMuZ2xvYmFsPWdsb2JhbFRoaXMuZ2xvYmFsfHxnbG9iYWxUaGlzKSwoZ2xvYmFsVGhpcy53aW5kb3c9Z2xvYmFsVGhpcy53aW5kb3d8fGdsb2JhbFRoaXMpKTtcbnZhciBfX2NyZWF0ZSA9IE9iamVjdC5jcmVhdGU7XG52YXIgX19kZWZQcm9wID0gT2JqZWN0LmRlZmluZVByb3BlcnR5O1xudmFyIF9fZ2V0T3duUHJvcERlc2MgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yO1xudmFyIF9fZ2V0T3duUHJvcE5hbWVzID0gT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXM7XG52YXIgX19nZXRQcm90b09mID0gT2JqZWN0LmdldFByb3RvdHlwZU9mO1xudmFyIF9faGFzT3duUHJvcCA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHk7XG52YXIgX19lc20gPSAoZm4sIHJlcykgPT4gZnVuY3Rpb24gX19pbml0KCkge1xuICByZXR1cm4gZm4gJiYgKHJlcyA9ICgwLCBmbltfX2dldE93blByb3BOYW1lcyhmbilbMF1dKShmbiA9IDApKSwgcmVzO1xufTtcbnZhciBfX2NvbW1vbkpTID0gKGNiLCBtb2QpID0+IGZ1bmN0aW9uIF9fcmVxdWlyZSgpIHtcbiAgcmV0dXJuIG1vZCB8fCAoMCwgY2JbX19nZXRPd25Qcm9wTmFtZXMoY2IpWzBdXSkoKG1vZCA9IHsgZXhwb3J0czoge30gfSkuZXhwb3J0cywgbW9kKSwgbW9kLmV4cG9ydHM7XG59O1xudmFyIF9fZXhwb3J0ID0gKHRhcmdldCwgYWxsKSA9PiB7XG4gIGZvciAodmFyIG5hbWUgaW4gYWxsKVxuICAgIF9fZGVmUHJvcCh0YXJnZXQsIG5hbWUsIHsgZ2V0OiBhbGxbbmFtZV0sIGVudW1lcmFibGU6IHRydWUgfSk7XG59O1xudmFyIF9fY29weVByb3BzID0gKHRvLCBmcm9tLCBleGNlcHQsIGRlc2MpID0+IHtcbiAgaWYgKGZyb20gJiYgdHlwZW9mIGZyb20gPT09IFwib2JqZWN0XCIgfHwgdHlwZW9mIGZyb20gPT09IFwiZnVuY3Rpb25cIikge1xuICAgIGZvciAobGV0IGtleSBvZiBfX2dldE93blByb3BOYW1lcyhmcm9tKSlcbiAgICAgIGlmICghX19oYXNPd25Qcm9wLmNhbGwodG8sIGtleSkgJiYga2V5ICE9PSBleGNlcHQpXG4gICAgICAgIF9fZGVmUHJvcCh0bywga2V5LCB7IGdldDogKCkgPT4gZnJvbVtrZXldLCBlbnVtZXJhYmxlOiAhKGRlc2MgPSBfX2dldE93blByb3BEZXNjKGZyb20sIGtleSkpIHx8IGRlc2MuZW51bWVyYWJsZSB9KTtcbiAgfVxuICByZXR1cm4gdG87XG59O1xudmFyIF9fdG9FU00gPSAobW9kLCBpc05vZGVNb2RlLCB0YXJnZXQpID0+ICh0YXJnZXQgPSBtb2QgIT0gbnVsbCA/IF9fY3JlYXRlKF9fZ2V0UHJvdG9PZihtb2QpKSA6IHt9LCBfX2NvcHlQcm9wcyhcbiAgLy8gSWYgdGhlIGltcG9ydGVyIGlzIGluIG5vZGUgY29tcGF0aWJpbGl0eSBtb2RlIG9yIHRoaXMgaXMgbm90IGFuIEVTTVxuICAvLyBmaWxlIHRoYXQgaGFzIGJlZW4gY29udmVydGVkIHRvIGEgQ29tbW9uSlMgZmlsZSB1c2luZyBhIEJhYmVsLVxuICAvLyBjb21wYXRpYmxlIHRyYW5zZm9ybSAoaS5lLiBcIl9fZXNNb2R1bGVcIiBoYXMgbm90IGJlZW4gc2V0KSwgdGhlbiBzZXRcbiAgLy8gXCJkZWZhdWx0XCIgdG8gdGhlIENvbW1vbkpTIFwibW9kdWxlLmV4cG9ydHNcIiBmb3Igbm9kZSBjb21wYXRpYmlsaXR5LlxuICBfX2RlZlByb3AodGFyZ2V0LCBcImRlZmF1bHRcIiwgeyB2YWx1ZTogbW9kLCBlbnVtZXJhYmxlOiB0cnVlIH0pICxcbiAgbW9kXG4pKTtcbnZhciBfX3RvQ29tbW9uSlMgPSAobW9kKSA9PiBfX2NvcHlQcm9wcyhfX2RlZlByb3Aoe30sIFwiX19lc01vZHVsZVwiLCB7IHZhbHVlOiB0cnVlIH0pLCBtb2QpO1xuXG4vLyAuLi8uLi9ub2RlX21vZHVsZXMvLnBucG0vYmFzZTY0LWpzQDEuNS4xL25vZGVfbW9kdWxlcy9iYXNlNjQtanMvaW5kZXguanNcbnZhciByZXF1aXJlX2Jhc2U2NF9qcyA9IF9fY29tbW9uSlMoe1xuICBcIi4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS9iYXNlNjQtanNAMS41LjEvbm9kZV9tb2R1bGVzL2Jhc2U2NC1qcy9pbmRleC5qc1wiKGV4cG9ydHMpIHtcbiAgICBleHBvcnRzLmJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoO1xuICAgIGV4cG9ydHMudG9CeXRlQXJyYXkgPSB0b0J5dGVBcnJheTtcbiAgICBleHBvcnRzLmZyb21CeXRlQXJyYXkgPSBmcm9tQnl0ZUFycmF5MjtcbiAgICB2YXIgbG9va3VwID0gW107XG4gICAgdmFyIHJldkxvb2t1cCA9IFtdO1xuICAgIHZhciBBcnIgPSB0eXBlb2YgVWludDhBcnJheSAhPT0gXCJ1bmRlZmluZWRcIiA/IFVpbnQ4QXJyYXkgOiBBcnJheTtcbiAgICB2YXIgY29kZSA9IFwiQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrL1wiO1xuICAgIGZvciAoaSA9IDAsIGxlbiA9IGNvZGUubGVuZ3RoOyBpIDwgbGVuOyArK2kpIHtcbiAgICAgIGxvb2t1cFtpXSA9IGNvZGVbaV07XG4gICAgICByZXZMb29rdXBbY29kZS5jaGFyQ29kZUF0KGkpXSA9IGk7XG4gICAgfVxuICAgIHZhciBpO1xuICAgIHZhciBsZW47XG4gICAgcmV2TG9va3VwW1wiLVwiLmNoYXJDb2RlQXQoMCldID0gNjI7XG4gICAgcmV2TG9va3VwW1wiX1wiLmNoYXJDb2RlQXQoMCldID0gNjM7XG4gICAgZnVuY3Rpb24gZ2V0TGVucyhiNjQpIHtcbiAgICAgIHZhciBsZW4yID0gYjY0Lmxlbmd0aDtcbiAgICAgIGlmIChsZW4yICUgNCA+IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBzdHJpbmcuIExlbmd0aCBtdXN0IGJlIGEgbXVsdGlwbGUgb2YgNFwiKTtcbiAgICAgIH1cbiAgICAgIHZhciB2YWxpZExlbiA9IGI2NC5pbmRleE9mKFwiPVwiKTtcbiAgICAgIGlmICh2YWxpZExlbiA9PT0gLTEpIHZhbGlkTGVuID0gbGVuMjtcbiAgICAgIHZhciBwbGFjZUhvbGRlcnNMZW4gPSB2YWxpZExlbiA9PT0gbGVuMiA/IDAgOiA0IC0gdmFsaWRMZW4gJSA0O1xuICAgICAgcmV0dXJuIFt2YWxpZExlbiwgcGxhY2VIb2xkZXJzTGVuXTtcbiAgICB9XG4gICAgZnVuY3Rpb24gYnl0ZUxlbmd0aChiNjQpIHtcbiAgICAgIHZhciBsZW5zID0gZ2V0TGVucyhiNjQpO1xuICAgICAgdmFyIHZhbGlkTGVuID0gbGVuc1swXTtcbiAgICAgIHZhciBwbGFjZUhvbGRlcnNMZW4gPSBsZW5zWzFdO1xuICAgICAgcmV0dXJuICh2YWxpZExlbiArIHBsYWNlSG9sZGVyc0xlbikgKiAzIC8gNCAtIHBsYWNlSG9sZGVyc0xlbjtcbiAgICB9XG4gICAgZnVuY3Rpb24gX2J5dGVMZW5ndGgoYjY0LCB2YWxpZExlbiwgcGxhY2VIb2xkZXJzTGVuKSB7XG4gICAgICByZXR1cm4gKHZhbGlkTGVuICsgcGxhY2VIb2xkZXJzTGVuKSAqIDMgLyA0IC0gcGxhY2VIb2xkZXJzTGVuO1xuICAgIH1cbiAgICBmdW5jdGlvbiB0b0J5dGVBcnJheShiNjQpIHtcbiAgICAgIHZhciB0bXA7XG4gICAgICB2YXIgbGVucyA9IGdldExlbnMoYjY0KTtcbiAgICAgIHZhciB2YWxpZExlbiA9IGxlbnNbMF07XG4gICAgICB2YXIgcGxhY2VIb2xkZXJzTGVuID0gbGVuc1sxXTtcbiAgICAgIHZhciBhcnIgPSBuZXcgQXJyKF9ieXRlTGVuZ3RoKGI2NCwgdmFsaWRMZW4sIHBsYWNlSG9sZGVyc0xlbikpO1xuICAgICAgdmFyIGN1ckJ5dGUgPSAwO1xuICAgICAgdmFyIGxlbjIgPSBwbGFjZUhvbGRlcnNMZW4gPiAwID8gdmFsaWRMZW4gLSA0IDogdmFsaWRMZW47XG4gICAgICB2YXIgaTI7XG4gICAgICBmb3IgKGkyID0gMDsgaTIgPCBsZW4yOyBpMiArPSA0KSB7XG4gICAgICAgIHRtcCA9IHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpMildIDw8IDE4IHwgcmV2TG9va3VwW2I2NC5jaGFyQ29kZUF0KGkyICsgMSldIDw8IDEyIHwgcmV2TG9va3VwW2I2NC5jaGFyQ29kZUF0KGkyICsgMildIDw8IDYgfCByZXZMb29rdXBbYjY0LmNoYXJDb2RlQXQoaTIgKyAzKV07XG4gICAgICAgIGFycltjdXJCeXRlKytdID0gdG1wID4+IDE2ICYgMjU1O1xuICAgICAgICBhcnJbY3VyQnl0ZSsrXSA9IHRtcCA+PiA4ICYgMjU1O1xuICAgICAgICBhcnJbY3VyQnl0ZSsrXSA9IHRtcCAmIDI1NTtcbiAgICAgIH1cbiAgICAgIGlmIChwbGFjZUhvbGRlcnNMZW4gPT09IDIpIHtcbiAgICAgICAgdG1wID0gcmV2TG9va3VwW2I2NC5jaGFyQ29kZUF0KGkyKV0gPDwgMiB8IHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpMiArIDEpXSA+PiA0O1xuICAgICAgICBhcnJbY3VyQnl0ZSsrXSA9IHRtcCAmIDI1NTtcbiAgICAgIH1cbiAgICAgIGlmIChwbGFjZUhvbGRlcnNMZW4gPT09IDEpIHtcbiAgICAgICAgdG1wID0gcmV2TG9va3VwW2I2NC5jaGFyQ29kZUF0KGkyKV0gPDwgMTAgfCByZXZMb29rdXBbYjY0LmNoYXJDb2RlQXQoaTIgKyAxKV0gPDwgNCB8IHJldkxvb2t1cFtiNjQuY2hhckNvZGVBdChpMiArIDIpXSA+PiAyO1xuICAgICAgICBhcnJbY3VyQnl0ZSsrXSA9IHRtcCA+PiA4ICYgMjU1O1xuICAgICAgICBhcnJbY3VyQnl0ZSsrXSA9IHRtcCAmIDI1NTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBhcnI7XG4gICAgfVxuICAgIGZ1bmN0aW9uIHRyaXBsZXRUb0Jhc2U2NChudW0pIHtcbiAgICAgIHJldHVybiBsb29rdXBbbnVtID4+IDE4ICYgNjNdICsgbG9va3VwW251bSA+PiAxMiAmIDYzXSArIGxvb2t1cFtudW0gPj4gNiAmIDYzXSArIGxvb2t1cFtudW0gJiA2M107XG4gICAgfVxuICAgIGZ1bmN0aW9uIGVuY29kZUNodW5rKHVpbnQ4LCBzdGFydCwgZW5kKSB7XG4gICAgICB2YXIgdG1wO1xuICAgICAgdmFyIG91dHB1dCA9IFtdO1xuICAgICAgZm9yICh2YXIgaTIgPSBzdGFydDsgaTIgPCBlbmQ7IGkyICs9IDMpIHtcbiAgICAgICAgdG1wID0gKHVpbnQ4W2kyXSA8PCAxNiAmIDE2NzExNjgwKSArICh1aW50OFtpMiArIDFdIDw8IDggJiA2NTI4MCkgKyAodWludDhbaTIgKyAyXSAmIDI1NSk7XG4gICAgICAgIG91dHB1dC5wdXNoKHRyaXBsZXRUb0Jhc2U2NCh0bXApKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBvdXRwdXQuam9pbihcIlwiKTtcbiAgICB9XG4gICAgZnVuY3Rpb24gZnJvbUJ5dGVBcnJheTIodWludDgpIHtcbiAgICAgIHZhciB0bXA7XG4gICAgICB2YXIgbGVuMiA9IHVpbnQ4Lmxlbmd0aDtcbiAgICAgIHZhciBleHRyYUJ5dGVzID0gbGVuMiAlIDM7XG4gICAgICB2YXIgcGFydHMgPSBbXTtcbiAgICAgIHZhciBtYXhDaHVua0xlbmd0aCA9IDE2MzgzO1xuICAgICAgZm9yICh2YXIgaTIgPSAwLCBsZW4yMiA9IGxlbjIgLSBleHRyYUJ5dGVzOyBpMiA8IGxlbjIyOyBpMiArPSBtYXhDaHVua0xlbmd0aCkge1xuICAgICAgICBwYXJ0cy5wdXNoKGVuY29kZUNodW5rKHVpbnQ4LCBpMiwgaTIgKyBtYXhDaHVua0xlbmd0aCA+IGxlbjIyID8gbGVuMjIgOiBpMiArIG1heENodW5rTGVuZ3RoKSk7XG4gICAgICB9XG4gICAgICBpZiAoZXh0cmFCeXRlcyA9PT0gMSkge1xuICAgICAgICB0bXAgPSB1aW50OFtsZW4yIC0gMV07XG4gICAgICAgIHBhcnRzLnB1c2goXG4gICAgICAgICAgbG9va3VwW3RtcCA+PiAyXSArIGxvb2t1cFt0bXAgPDwgNCAmIDYzXSArIFwiPT1cIlxuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChleHRyYUJ5dGVzID09PSAyKSB7XG4gICAgICAgIHRtcCA9ICh1aW50OFtsZW4yIC0gMl0gPDwgOCkgKyB1aW50OFtsZW4yIC0gMV07XG4gICAgICAgIHBhcnRzLnB1c2goXG4gICAgICAgICAgbG9va3VwW3RtcCA+PiAxMF0gKyBsb29rdXBbdG1wID4+IDQgJiA2M10gKyBsb29rdXBbdG1wIDw8IDIgJiA2M10gKyBcIj1cIlxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHBhcnRzLmpvaW4oXCJcIik7XG4gICAgfVxuICB9XG59KTtcblxuLy8gLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL3N0YXR1c2VzQDIuMC4yL25vZGVfbW9kdWxlcy9zdGF0dXNlcy9jb2Rlcy5qc29uXG52YXIgcmVxdWlyZV9jb2RlcyA9IF9fY29tbW9uSlMoe1xuICBcIi4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS9zdGF0dXNlc0AyLjAuMi9ub2RlX21vZHVsZXMvc3RhdHVzZXMvY29kZXMuanNvblwiKGV4cG9ydHMsIG1vZHVsZSkge1xuICAgIG1vZHVsZS5leHBvcnRzID0ge1xuICAgICAgXCIxMDBcIjogXCJDb250aW51ZVwiLFxuICAgICAgXCIxMDFcIjogXCJTd2l0Y2hpbmcgUHJvdG9jb2xzXCIsXG4gICAgICBcIjEwMlwiOiBcIlByb2Nlc3NpbmdcIixcbiAgICAgIFwiMTAzXCI6IFwiRWFybHkgSGludHNcIixcbiAgICAgIFwiMjAwXCI6IFwiT0tcIixcbiAgICAgIFwiMjAxXCI6IFwiQ3JlYXRlZFwiLFxuICAgICAgXCIyMDJcIjogXCJBY2NlcHRlZFwiLFxuICAgICAgXCIyMDNcIjogXCJOb24tQXV0aG9yaXRhdGl2ZSBJbmZvcm1hdGlvblwiLFxuICAgICAgXCIyMDRcIjogXCJObyBDb250ZW50XCIsXG4gICAgICBcIjIwNVwiOiBcIlJlc2V0IENvbnRlbnRcIixcbiAgICAgIFwiMjA2XCI6IFwiUGFydGlhbCBDb250ZW50XCIsXG4gICAgICBcIjIwN1wiOiBcIk11bHRpLVN0YXR1c1wiLFxuICAgICAgXCIyMDhcIjogXCJBbHJlYWR5IFJlcG9ydGVkXCIsXG4gICAgICBcIjIyNlwiOiBcIklNIFVzZWRcIixcbiAgICAgIFwiMzAwXCI6IFwiTXVsdGlwbGUgQ2hvaWNlc1wiLFxuICAgICAgXCIzMDFcIjogXCJNb3ZlZCBQZXJtYW5lbnRseVwiLFxuICAgICAgXCIzMDJcIjogXCJGb3VuZFwiLFxuICAgICAgXCIzMDNcIjogXCJTZWUgT3RoZXJcIixcbiAgICAgIFwiMzA0XCI6IFwiTm90IE1vZGlmaWVkXCIsXG4gICAgICBcIjMwNVwiOiBcIlVzZSBQcm94eVwiLFxuICAgICAgXCIzMDdcIjogXCJUZW1wb3JhcnkgUmVkaXJlY3RcIixcbiAgICAgIFwiMzA4XCI6IFwiUGVybWFuZW50IFJlZGlyZWN0XCIsXG4gICAgICBcIjQwMFwiOiBcIkJhZCBSZXF1ZXN0XCIsXG4gICAgICBcIjQwMVwiOiBcIlVuYXV0aG9yaXplZFwiLFxuICAgICAgXCI0MDJcIjogXCJQYXltZW50IFJlcXVpcmVkXCIsXG4gICAgICBcIjQwM1wiOiBcIkZvcmJpZGRlblwiLFxuICAgICAgXCI0MDRcIjogXCJOb3QgRm91bmRcIixcbiAgICAgIFwiNDA1XCI6IFwiTWV0aG9kIE5vdCBBbGxvd2VkXCIsXG4gICAgICBcIjQwNlwiOiBcIk5vdCBBY2NlcHRhYmxlXCIsXG4gICAgICBcIjQwN1wiOiBcIlByb3h5IEF1dGhlbnRpY2F0aW9uIFJlcXVpcmVkXCIsXG4gICAgICBcIjQwOFwiOiBcIlJlcXVlc3QgVGltZW91dFwiLFxuICAgICAgXCI0MDlcIjogXCJDb25mbGljdFwiLFxuICAgICAgXCI0MTBcIjogXCJHb25lXCIsXG4gICAgICBcIjQxMVwiOiBcIkxlbmd0aCBSZXF1aXJlZFwiLFxuICAgICAgXCI0MTJcIjogXCJQcmVjb25kaXRpb24gRmFpbGVkXCIsXG4gICAgICBcIjQxM1wiOiBcIlBheWxvYWQgVG9vIExhcmdlXCIsXG4gICAgICBcIjQxNFwiOiBcIlVSSSBUb28gTG9uZ1wiLFxuICAgICAgXCI0MTVcIjogXCJVbnN1cHBvcnRlZCBNZWRpYSBUeXBlXCIsXG4gICAgICBcIjQxNlwiOiBcIlJhbmdlIE5vdCBTYXRpc2ZpYWJsZVwiLFxuICAgICAgXCI0MTdcIjogXCJFeHBlY3RhdGlvbiBGYWlsZWRcIixcbiAgICAgIFwiNDE4XCI6IFwiSSdtIGEgVGVhcG90XCIsXG4gICAgICBcIjQyMVwiOiBcIk1pc2RpcmVjdGVkIFJlcXVlc3RcIixcbiAgICAgIFwiNDIyXCI6IFwiVW5wcm9jZXNzYWJsZSBFbnRpdHlcIixcbiAgICAgIFwiNDIzXCI6IFwiTG9ja2VkXCIsXG4gICAgICBcIjQyNFwiOiBcIkZhaWxlZCBEZXBlbmRlbmN5XCIsXG4gICAgICBcIjQyNVwiOiBcIlRvbyBFYXJseVwiLFxuICAgICAgXCI0MjZcIjogXCJVcGdyYWRlIFJlcXVpcmVkXCIsXG4gICAgICBcIjQyOFwiOiBcIlByZWNvbmRpdGlvbiBSZXF1aXJlZFwiLFxuICAgICAgXCI0MjlcIjogXCJUb28gTWFueSBSZXF1ZXN0c1wiLFxuICAgICAgXCI0MzFcIjogXCJSZXF1ZXN0IEhlYWRlciBGaWVsZHMgVG9vIExhcmdlXCIsXG4gICAgICBcIjQ1MVwiOiBcIlVuYXZhaWxhYmxlIEZvciBMZWdhbCBSZWFzb25zXCIsXG4gICAgICBcIjUwMFwiOiBcIkludGVybmFsIFNlcnZlciBFcnJvclwiLFxuICAgICAgXCI1MDFcIjogXCJOb3QgSW1wbGVtZW50ZWRcIixcbiAgICAgIFwiNTAyXCI6IFwiQmFkIEdhdGV3YXlcIixcbiAgICAgIFwiNTAzXCI6IFwiU2VydmljZSBVbmF2YWlsYWJsZVwiLFxuICAgICAgXCI1MDRcIjogXCJHYXRld2F5IFRpbWVvdXRcIixcbiAgICAgIFwiNTA1XCI6IFwiSFRUUCBWZXJzaW9uIE5vdCBTdXBwb3J0ZWRcIixcbiAgICAgIFwiNTA2XCI6IFwiVmFyaWFudCBBbHNvIE5lZ290aWF0ZXNcIixcbiAgICAgIFwiNTA3XCI6IFwiSW5zdWZmaWNpZW50IFN0b3JhZ2VcIixcbiAgICAgIFwiNTA4XCI6IFwiTG9vcCBEZXRlY3RlZFwiLFxuICAgICAgXCI1MDlcIjogXCJCYW5kd2lkdGggTGltaXQgRXhjZWVkZWRcIixcbiAgICAgIFwiNTEwXCI6IFwiTm90IEV4dGVuZGVkXCIsXG4gICAgICBcIjUxMVwiOiBcIk5ldHdvcmsgQXV0aGVudGljYXRpb24gUmVxdWlyZWRcIlxuICAgIH07XG4gIH1cbn0pO1xuXG4vLyAuLi8uLi9ub2RlX21vZHVsZXMvLnBucG0vc3RhdHVzZXNAMi4wLjIvbm9kZV9tb2R1bGVzL3N0YXR1c2VzL2luZGV4LmpzXG52YXIgcmVxdWlyZV9zdGF0dXNlcyA9IF9fY29tbW9uSlMoe1xuICBcIi4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS9zdGF0dXNlc0AyLjAuMi9ub2RlX21vZHVsZXMvc3RhdHVzZXMvaW5kZXguanNcIihleHBvcnRzLCBtb2R1bGUpIHtcbiAgICB2YXIgY29kZXMgPSByZXF1aXJlX2NvZGVzKCk7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBzdGF0dXMyO1xuICAgIHN0YXR1czIubWVzc2FnZSA9IGNvZGVzO1xuICAgIHN0YXR1czIuY29kZSA9IGNyZWF0ZU1lc3NhZ2VUb1N0YXR1c0NvZGVNYXAoY29kZXMpO1xuICAgIHN0YXR1czIuY29kZXMgPSBjcmVhdGVTdGF0dXNDb2RlTGlzdChjb2Rlcyk7XG4gICAgc3RhdHVzMi5yZWRpcmVjdCA9IHtcbiAgICAgIDMwMDogdHJ1ZSxcbiAgICAgIDMwMTogdHJ1ZSxcbiAgICAgIDMwMjogdHJ1ZSxcbiAgICAgIDMwMzogdHJ1ZSxcbiAgICAgIDMwNTogdHJ1ZSxcbiAgICAgIDMwNzogdHJ1ZSxcbiAgICAgIDMwODogdHJ1ZVxuICAgIH07XG4gICAgc3RhdHVzMi5lbXB0eSA9IHtcbiAgICAgIDIwNDogdHJ1ZSxcbiAgICAgIDIwNTogdHJ1ZSxcbiAgICAgIDMwNDogdHJ1ZVxuICAgIH07XG4gICAgc3RhdHVzMi5yZXRyeSA9IHtcbiAgICAgIDUwMjogdHJ1ZSxcbiAgICAgIDUwMzogdHJ1ZSxcbiAgICAgIDUwNDogdHJ1ZVxuICAgIH07XG4gICAgZnVuY3Rpb24gY3JlYXRlTWVzc2FnZVRvU3RhdHVzQ29kZU1hcChjb2RlczIpIHtcbiAgICAgIHZhciBtYXAgPSB7fTtcbiAgICAgIE9iamVjdC5rZXlzKGNvZGVzMikuZm9yRWFjaChmdW5jdGlvbiBmb3JFYWNoQ29kZShjb2RlKSB7XG4gICAgICAgIHZhciBtZXNzYWdlID0gY29kZXMyW2NvZGVdO1xuICAgICAgICB2YXIgc3RhdHVzMyA9IE51bWJlcihjb2RlKTtcbiAgICAgICAgbWFwW21lc3NhZ2UudG9Mb3dlckNhc2UoKV0gPSBzdGF0dXMzO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gbWFwO1xuICAgIH1cbiAgICBmdW5jdGlvbiBjcmVhdGVTdGF0dXNDb2RlTGlzdChjb2RlczIpIHtcbiAgICAgIHJldHVybiBPYmplY3Qua2V5cyhjb2RlczIpLm1hcChmdW5jdGlvbiBtYXBDb2RlKGNvZGUpIHtcbiAgICAgICAgcmV0dXJuIE51bWJlcihjb2RlKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBmdW5jdGlvbiBnZXRTdGF0dXNDb2RlKG1lc3NhZ2UpIHtcbiAgICAgIHZhciBtc2cgPSBtZXNzYWdlLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChzdGF0dXMyLmNvZGUsIG1zZykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdpbnZhbGlkIHN0YXR1cyBtZXNzYWdlOiBcIicgKyBtZXNzYWdlICsgJ1wiJyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gc3RhdHVzMi5jb2RlW21zZ107XG4gICAgfVxuICAgIGZ1bmN0aW9uIGdldFN0YXR1c01lc3NhZ2UoY29kZSkge1xuICAgICAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoc3RhdHVzMi5tZXNzYWdlLCBjb2RlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbnZhbGlkIHN0YXR1cyBjb2RlOiBcIiArIGNvZGUpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHN0YXR1czIubWVzc2FnZVtjb2RlXTtcbiAgICB9XG4gICAgZnVuY3Rpb24gc3RhdHVzMihjb2RlKSB7XG4gICAgICBpZiAodHlwZW9mIGNvZGUgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgcmV0dXJuIGdldFN0YXR1c01lc3NhZ2UoY29kZSk7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIGNvZGUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcImNvZGUgbXVzdCBiZSBhIG51bWJlciBvciBzdHJpbmdcIik7XG4gICAgICB9XG4gICAgICB2YXIgbiA9IHBhcnNlSW50KGNvZGUsIDEwKTtcbiAgICAgIGlmICghaXNOYU4obikpIHtcbiAgICAgICAgcmV0dXJuIGdldFN0YXR1c01lc3NhZ2Uobik7XG4gICAgICB9XG4gICAgICByZXR1cm4gZ2V0U3RhdHVzQ29kZShjb2RlKTtcbiAgICB9XG4gIH1cbn0pO1xuXG4vLyBzcmMvdXRpbC1zdHViLnRzXG52YXIgdXRpbF9zdHViX2V4cG9ydHMgPSB7fTtcbl9fZXhwb3J0KHV0aWxfc3R1Yl9leHBvcnRzLCB7XG4gIGluc3BlY3Q6ICgpID0+IGluc3BlY3Rcbn0pO1xudmFyIGluc3BlY3Q7XG52YXIgaW5pdF91dGlsX3N0dWIgPSBfX2VzbSh7XG4gIFwic3JjL3V0aWwtc3R1Yi50c1wiKCkge1xuICAgIGluc3BlY3QgPSB7fTtcbiAgfVxufSk7XG5cbi8vIC4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS9vYmplY3QtaW5zcGVjdEAxLjEzLjQvbm9kZV9tb2R1bGVzL29iamVjdC1pbnNwZWN0L3V0aWwuaW5zcGVjdC5qc1xudmFyIHJlcXVpcmVfdXRpbF9pbnNwZWN0ID0gX19jb21tb25KUyh7XG4gIFwiLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL29iamVjdC1pbnNwZWN0QDEuMTMuNC9ub2RlX21vZHVsZXMvb2JqZWN0LWluc3BlY3QvdXRpbC5pbnNwZWN0LmpzXCIoZXhwb3J0cywgbW9kdWxlKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSAoaW5pdF91dGlsX3N0dWIoKSwgX190b0NvbW1vbkpTKHV0aWxfc3R1Yl9leHBvcnRzKSkuaW5zcGVjdDtcbiAgfVxufSk7XG5cbi8vIC4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS9vYmplY3QtaW5zcGVjdEAxLjEzLjQvbm9kZV9tb2R1bGVzL29iamVjdC1pbnNwZWN0L2luZGV4LmpzXG52YXIgcmVxdWlyZV9vYmplY3RfaW5zcGVjdCA9IF9fY29tbW9uSlMoe1xuICBcIi4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS9vYmplY3QtaW5zcGVjdEAxLjEzLjQvbm9kZV9tb2R1bGVzL29iamVjdC1pbnNwZWN0L2luZGV4LmpzXCIoZXhwb3J0cywgbW9kdWxlKSB7XG4gICAgdmFyIGhhc01hcCA9IHR5cGVvZiBNYXAgPT09IFwiZnVuY3Rpb25cIiAmJiBNYXAucHJvdG90eXBlO1xuICAgIHZhciBtYXBTaXplRGVzY3JpcHRvciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IgJiYgaGFzTWFwID8gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihNYXAucHJvdG90eXBlLCBcInNpemVcIikgOiBudWxsO1xuICAgIHZhciBtYXBTaXplID0gaGFzTWFwICYmIG1hcFNpemVEZXNjcmlwdG9yICYmIHR5cGVvZiBtYXBTaXplRGVzY3JpcHRvci5nZXQgPT09IFwiZnVuY3Rpb25cIiA/IG1hcFNpemVEZXNjcmlwdG9yLmdldCA6IG51bGw7XG4gICAgdmFyIG1hcEZvckVhY2ggPSBoYXNNYXAgJiYgTWFwLnByb3RvdHlwZS5mb3JFYWNoO1xuICAgIHZhciBoYXNTZXQgPSB0eXBlb2YgU2V0ID09PSBcImZ1bmN0aW9uXCIgJiYgU2V0LnByb3RvdHlwZTtcbiAgICB2YXIgc2V0U2l6ZURlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yICYmIGhhc1NldCA/IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoU2V0LnByb3RvdHlwZSwgXCJzaXplXCIpIDogbnVsbDtcbiAgICB2YXIgc2V0U2l6ZSA9IGhhc1NldCAmJiBzZXRTaXplRGVzY3JpcHRvciAmJiB0eXBlb2Ygc2V0U2l6ZURlc2NyaXB0b3IuZ2V0ID09PSBcImZ1bmN0aW9uXCIgPyBzZXRTaXplRGVzY3JpcHRvci5nZXQgOiBudWxsO1xuICAgIHZhciBzZXRGb3JFYWNoID0gaGFzU2V0ICYmIFNldC5wcm90b3R5cGUuZm9yRWFjaDtcbiAgICB2YXIgaGFzV2Vha01hcCA9IHR5cGVvZiBXZWFrTWFwID09PSBcImZ1bmN0aW9uXCIgJiYgV2Vha01hcC5wcm90b3R5cGU7XG4gICAgdmFyIHdlYWtNYXBIYXMgPSBoYXNXZWFrTWFwID8gV2Vha01hcC5wcm90b3R5cGUuaGFzIDogbnVsbDtcbiAgICB2YXIgaGFzV2Vha1NldCA9IHR5cGVvZiBXZWFrU2V0ID09PSBcImZ1bmN0aW9uXCIgJiYgV2Vha1NldC5wcm90b3R5cGU7XG4gICAgdmFyIHdlYWtTZXRIYXMgPSBoYXNXZWFrU2V0ID8gV2Vha1NldC5wcm90b3R5cGUuaGFzIDogbnVsbDtcbiAgICB2YXIgaGFzV2Vha1JlZiA9IHR5cGVvZiBXZWFrUmVmID09PSBcImZ1bmN0aW9uXCIgJiYgV2Vha1JlZi5wcm90b3R5cGU7XG4gICAgdmFyIHdlYWtSZWZEZXJlZiA9IGhhc1dlYWtSZWYgPyBXZWFrUmVmLnByb3RvdHlwZS5kZXJlZiA6IG51bGw7XG4gICAgdmFyIGJvb2xlYW5WYWx1ZU9mID0gQm9vbGVhbi5wcm90b3R5cGUudmFsdWVPZjtcbiAgICB2YXIgb2JqZWN0VG9TdHJpbmcgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nO1xuICAgIHZhciBmdW5jdGlvblRvU3RyaW5nID0gRnVuY3Rpb24ucHJvdG90eXBlLnRvU3RyaW5nO1xuICAgIHZhciAkbWF0Y2ggPSBTdHJpbmcucHJvdG90eXBlLm1hdGNoO1xuICAgIHZhciAkc2xpY2UgPSBTdHJpbmcucHJvdG90eXBlLnNsaWNlO1xuICAgIHZhciAkcmVwbGFjZSA9IFN0cmluZy5wcm90b3R5cGUucmVwbGFjZTtcbiAgICB2YXIgJHRvVXBwZXJDYXNlID0gU3RyaW5nLnByb3RvdHlwZS50b1VwcGVyQ2FzZTtcbiAgICB2YXIgJHRvTG93ZXJDYXNlID0gU3RyaW5nLnByb3RvdHlwZS50b0xvd2VyQ2FzZTtcbiAgICB2YXIgJHRlc3QgPSBSZWdFeHAucHJvdG90eXBlLnRlc3Q7XG4gICAgdmFyICRjb25jYXQgPSBBcnJheS5wcm90b3R5cGUuY29uY2F0O1xuICAgIHZhciAkam9pbiA9IEFycmF5LnByb3RvdHlwZS5qb2luO1xuICAgIHZhciAkYXJyU2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG4gICAgdmFyICRmbG9vciA9IE1hdGguZmxvb3I7XG4gICAgdmFyIGJpZ0ludFZhbHVlT2YgPSB0eXBlb2YgQmlnSW50ID09PSBcImZ1bmN0aW9uXCIgPyBCaWdJbnQucHJvdG90eXBlLnZhbHVlT2YgOiBudWxsO1xuICAgIHZhciBnT1BTID0gT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scztcbiAgICB2YXIgc3ltVG9TdHJpbmcgPSB0eXBlb2YgU3ltYm9sID09PSBcImZ1bmN0aW9uXCIgJiYgdHlwZW9mIFN5bWJvbC5pdGVyYXRvciA9PT0gXCJzeW1ib2xcIiA/IFN5bWJvbC5wcm90b3R5cGUudG9TdHJpbmcgOiBudWxsO1xuICAgIHZhciBoYXNTaGFtbWVkU3ltYm9scyA9IHR5cGVvZiBTeW1ib2wgPT09IFwiZnVuY3Rpb25cIiAmJiB0eXBlb2YgU3ltYm9sLml0ZXJhdG9yID09PSBcIm9iamVjdFwiO1xuICAgIHZhciB0b1N0cmluZ1RhZyA9IHR5cGVvZiBTeW1ib2wgPT09IFwiZnVuY3Rpb25cIiAmJiBTeW1ib2wudG9TdHJpbmdUYWcgJiYgKHR5cGVvZiBTeW1ib2wudG9TdHJpbmdUYWcgPT09IGhhc1NoYW1tZWRTeW1ib2xzID8gXCJvYmplY3RcIiA6IFwic3ltYm9sXCIpID8gU3ltYm9sLnRvU3RyaW5nVGFnIDogbnVsbDtcbiAgICB2YXIgaXNFbnVtZXJhYmxlID0gT2JqZWN0LnByb3RvdHlwZS5wcm9wZXJ0eUlzRW51bWVyYWJsZTtcbiAgICB2YXIgZ1BPID0gKHR5cGVvZiBSZWZsZWN0ID09PSBcImZ1bmN0aW9uXCIgPyBSZWZsZWN0LmdldFByb3RvdHlwZU9mIDogT2JqZWN0LmdldFByb3RvdHlwZU9mKSB8fCAoW10uX19wcm90b19fID09PSBBcnJheS5wcm90b3R5cGUgPyBmdW5jdGlvbihPKSB7XG4gICAgICByZXR1cm4gTy5fX3Byb3RvX187XG4gICAgfSA6IG51bGwpO1xuICAgIGZ1bmN0aW9uIGFkZE51bWVyaWNTZXBhcmF0b3IobnVtLCBzdHIpIHtcbiAgICAgIGlmIChudW0gPT09IEluZmluaXR5IHx8IG51bSA9PT0gLUluZmluaXR5IHx8IG51bSAhPT0gbnVtIHx8IG51bSAmJiBudW0gPiAtMWUzICYmIG51bSA8IDFlMyB8fCAkdGVzdC5jYWxsKC9lLywgc3RyKSkge1xuICAgICAgICByZXR1cm4gc3RyO1xuICAgICAgfVxuICAgICAgdmFyIHNlcFJlZ2V4ID0gL1swLTldKD89KD86WzAtOV17M30pKyg/IVswLTldKSkvZztcbiAgICAgIGlmICh0eXBlb2YgbnVtID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgIHZhciBpbnQgPSBudW0gPCAwID8gLSRmbG9vcigtbnVtKSA6ICRmbG9vcihudW0pO1xuICAgICAgICBpZiAoaW50ICE9PSBudW0pIHtcbiAgICAgICAgICB2YXIgaW50U3RyID0gU3RyaW5nKGludCk7XG4gICAgICAgICAgdmFyIGRlYyA9ICRzbGljZS5jYWxsKHN0ciwgaW50U3RyLmxlbmd0aCArIDEpO1xuICAgICAgICAgIHJldHVybiAkcmVwbGFjZS5jYWxsKGludFN0ciwgc2VwUmVnZXgsIFwiJCZfXCIpICsgXCIuXCIgKyAkcmVwbGFjZS5jYWxsKCRyZXBsYWNlLmNhbGwoZGVjLCAvKFswLTldezN9KS9nLCBcIiQmX1wiKSwgL18kLywgXCJcIik7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiAkcmVwbGFjZS5jYWxsKHN0ciwgc2VwUmVnZXgsIFwiJCZfXCIpO1xuICAgIH1cbiAgICB2YXIgdXRpbEluc3BlY3QgPSByZXF1aXJlX3V0aWxfaW5zcGVjdCgpO1xuICAgIHZhciBpbnNwZWN0Q3VzdG9tID0gdXRpbEluc3BlY3QuY3VzdG9tO1xuICAgIHZhciBpbnNwZWN0U3ltYm9sID0gaXNTeW1ib2woaW5zcGVjdEN1c3RvbSkgPyBpbnNwZWN0Q3VzdG9tIDogbnVsbDtcbiAgICB2YXIgcXVvdGVzID0ge1xuICAgICAgX19wcm90b19fOiBudWxsLFxuICAgICAgXCJkb3VibGVcIjogJ1wiJyxcbiAgICAgIHNpbmdsZTogXCInXCJcbiAgICB9O1xuICAgIHZhciBxdW90ZVJFcyA9IHtcbiAgICAgIF9fcHJvdG9fXzogbnVsbCxcbiAgICAgIFwiZG91YmxlXCI6IC8oW1wiXFxcXF0pL2csXG4gICAgICBzaW5nbGU6IC8oWydcXFxcXSkvZ1xuICAgIH07XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpbnNwZWN0XyhvYmosIG9wdGlvbnMsIGRlcHRoLCBzZWVuKSB7XG4gICAgICB2YXIgb3B0cyA9IG9wdGlvbnMgfHwge307XG4gICAgICBpZiAoaGFzKG9wdHMsIFwicXVvdGVTdHlsZVwiKSAmJiAhaGFzKHF1b3Rlcywgb3B0cy5xdW90ZVN0eWxlKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb24gXCJxdW90ZVN0eWxlXCIgbXVzdCBiZSBcInNpbmdsZVwiIG9yIFwiZG91YmxlXCInKTtcbiAgICAgIH1cbiAgICAgIGlmIChoYXMob3B0cywgXCJtYXhTdHJpbmdMZW5ndGhcIikgJiYgKHR5cGVvZiBvcHRzLm1heFN0cmluZ0xlbmd0aCA9PT0gXCJudW1iZXJcIiA/IG9wdHMubWF4U3RyaW5nTGVuZ3RoIDwgMCAmJiBvcHRzLm1heFN0cmluZ0xlbmd0aCAhPT0gSW5maW5pdHkgOiBvcHRzLm1heFN0cmluZ0xlbmd0aCAhPT0gbnVsbCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9uIFwibWF4U3RyaW5nTGVuZ3RoXCIsIGlmIHByb3ZpZGVkLCBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlciwgSW5maW5pdHksIG9yIGBudWxsYCcpO1xuICAgICAgfVxuICAgICAgdmFyIGN1c3RvbUluc3BlY3QgPSBoYXMob3B0cywgXCJjdXN0b21JbnNwZWN0XCIpID8gb3B0cy5jdXN0b21JbnNwZWN0IDogdHJ1ZTtcbiAgICAgIGlmICh0eXBlb2YgY3VzdG9tSW5zcGVjdCAhPT0gXCJib29sZWFuXCIgJiYgY3VzdG9tSW5zcGVjdCAhPT0gXCJzeW1ib2xcIikge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwib3B0aW9uIFxcXCJjdXN0b21JbnNwZWN0XFxcIiwgaWYgcHJvdmlkZWQsIG11c3QgYmUgYHRydWVgLCBgZmFsc2VgLCBvciBgJ3N5bWJvbCdgXCIpO1xuICAgICAgfVxuICAgICAgaWYgKGhhcyhvcHRzLCBcImluZGVudFwiKSAmJiBvcHRzLmluZGVudCAhPT0gbnVsbCAmJiBvcHRzLmluZGVudCAhPT0gXCJcdFwiICYmICEocGFyc2VJbnQob3B0cy5pbmRlbnQsIDEwKSA9PT0gb3B0cy5pbmRlbnQgJiYgb3B0cy5pbmRlbnQgPiAwKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvcHRpb24gXCJpbmRlbnRcIiBtdXN0IGJlIFwiXFxcXHRcIiwgYW4gaW50ZWdlciA+IDAsIG9yIGBudWxsYCcpO1xuICAgICAgfVxuICAgICAgaWYgKGhhcyhvcHRzLCBcIm51bWVyaWNTZXBhcmF0b3JcIikgJiYgdHlwZW9mIG9wdHMubnVtZXJpY1NlcGFyYXRvciAhPT0gXCJib29sZWFuXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9uIFwibnVtZXJpY1NlcGFyYXRvclwiLCBpZiBwcm92aWRlZCwgbXVzdCBiZSBgdHJ1ZWAgb3IgYGZhbHNlYCcpO1xuICAgICAgfVxuICAgICAgdmFyIG51bWVyaWNTZXBhcmF0b3IgPSBvcHRzLm51bWVyaWNTZXBhcmF0b3I7XG4gICAgICBpZiAodHlwZW9mIG9iaiA9PT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICByZXR1cm4gXCJ1bmRlZmluZWRcIjtcbiAgICAgIH1cbiAgICAgIGlmIChvYmogPT09IG51bGwpIHtcbiAgICAgICAgcmV0dXJuIFwibnVsbFwiO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiBvYmogPT09IFwiYm9vbGVhblwiKSB7XG4gICAgICAgIHJldHVybiBvYmogPyBcInRydWVcIiA6IFwiZmFsc2VcIjtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2Ygb2JqID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHJldHVybiBpbnNwZWN0U3RyaW5nKG9iaiwgb3B0cyk7XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIG9iaiA9PT0gXCJudW1iZXJcIikge1xuICAgICAgICBpZiAob2JqID09PSAwKSB7XG4gICAgICAgICAgcmV0dXJuIEluZmluaXR5IC8gb2JqID4gMCA/IFwiMFwiIDogXCItMFwiO1xuICAgICAgICB9XG4gICAgICAgIHZhciBzdHIgPSBTdHJpbmcob2JqKTtcbiAgICAgICAgcmV0dXJuIG51bWVyaWNTZXBhcmF0b3IgPyBhZGROdW1lcmljU2VwYXJhdG9yKG9iaiwgc3RyKSA6IHN0cjtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2Ygb2JqID09PSBcImJpZ2ludFwiKSB7XG4gICAgICAgIHZhciBiaWdJbnRTdHIgPSBTdHJpbmcob2JqKSArIFwiblwiO1xuICAgICAgICByZXR1cm4gbnVtZXJpY1NlcGFyYXRvciA/IGFkZE51bWVyaWNTZXBhcmF0b3Iob2JqLCBiaWdJbnRTdHIpIDogYmlnSW50U3RyO1xuICAgICAgfVxuICAgICAgdmFyIG1heERlcHRoID0gdHlwZW9mIG9wdHMuZGVwdGggPT09IFwidW5kZWZpbmVkXCIgPyA1IDogb3B0cy5kZXB0aDtcbiAgICAgIGlmICh0eXBlb2YgZGVwdGggPT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgZGVwdGggPSAwO1xuICAgICAgfVxuICAgICAgaWYgKGRlcHRoID49IG1heERlcHRoICYmIG1heERlcHRoID4gMCAmJiB0eXBlb2Ygb2JqID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHJldHVybiBpc0FycmF5KG9iaikgPyBcIltBcnJheV1cIiA6IFwiW09iamVjdF1cIjtcbiAgICAgIH1cbiAgICAgIHZhciBpbmRlbnQgPSBnZXRJbmRlbnQob3B0cywgZGVwdGgpO1xuICAgICAgaWYgKHR5cGVvZiBzZWVuID09PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIHNlZW4gPSBbXTtcbiAgICAgIH0gZWxzZSBpZiAoaW5kZXhPZihzZWVuLCBvYmopID49IDApIHtcbiAgICAgICAgcmV0dXJuIFwiW0NpcmN1bGFyXVwiO1xuICAgICAgfVxuICAgICAgZnVuY3Rpb24gaW5zcGVjdDModmFsdWUsIGZyb20sIG5vSW5kZW50KSB7XG4gICAgICAgIGlmIChmcm9tKSB7XG4gICAgICAgICAgc2VlbiA9ICRhcnJTbGljZS5jYWxsKHNlZW4pO1xuICAgICAgICAgIHNlZW4ucHVzaChmcm9tKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobm9JbmRlbnQpIHtcbiAgICAgICAgICB2YXIgbmV3T3B0cyA9IHtcbiAgICAgICAgICAgIGRlcHRoOiBvcHRzLmRlcHRoXG4gICAgICAgICAgfTtcbiAgICAgICAgICBpZiAoaGFzKG9wdHMsIFwicXVvdGVTdHlsZVwiKSkge1xuICAgICAgICAgICAgbmV3T3B0cy5xdW90ZVN0eWxlID0gb3B0cy5xdW90ZVN0eWxlO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gaW5zcGVjdF8odmFsdWUsIG5ld09wdHMsIGRlcHRoICsgMSwgc2Vlbik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGluc3BlY3RfKHZhbHVlLCBvcHRzLCBkZXB0aCArIDEsIHNlZW4pO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiBvYmogPT09IFwiZnVuY3Rpb25cIiAmJiAhaXNSZWdFeHAob2JqKSkge1xuICAgICAgICB2YXIgbmFtZSA9IG5hbWVPZihvYmopO1xuICAgICAgICB2YXIga2V5cyA9IGFyck9iaktleXMob2JqLCBpbnNwZWN0Myk7XG4gICAgICAgIHJldHVybiBcIltGdW5jdGlvblwiICsgKG5hbWUgPyBcIjogXCIgKyBuYW1lIDogXCIgKGFub255bW91cylcIikgKyBcIl1cIiArIChrZXlzLmxlbmd0aCA+IDAgPyBcIiB7IFwiICsgJGpvaW4uY2FsbChrZXlzLCBcIiwgXCIpICsgXCIgfVwiIDogXCJcIik7XG4gICAgICB9XG4gICAgICBpZiAoaXNTeW1ib2wob2JqKSkge1xuICAgICAgICB2YXIgc3ltU3RyaW5nID0gaGFzU2hhbW1lZFN5bWJvbHMgPyAkcmVwbGFjZS5jYWxsKFN0cmluZyhvYmopLCAvXihTeW1ib2xcXCguKlxcKSlfW14pXSokLywgXCIkMVwiKSA6IHN5bVRvU3RyaW5nLmNhbGwob2JqKTtcbiAgICAgICAgcmV0dXJuIHR5cGVvZiBvYmogPT09IFwib2JqZWN0XCIgJiYgIWhhc1NoYW1tZWRTeW1ib2xzID8gbWFya0JveGVkKHN5bVN0cmluZykgOiBzeW1TdHJpbmc7XG4gICAgICB9XG4gICAgICBpZiAoaXNFbGVtZW50KG9iaikpIHtcbiAgICAgICAgdmFyIHMgPSBcIjxcIiArICR0b0xvd2VyQ2FzZS5jYWxsKFN0cmluZyhvYmoubm9kZU5hbWUpKTtcbiAgICAgICAgdmFyIGF0dHJzID0gb2JqLmF0dHJpYnV0ZXMgfHwgW107XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXR0cnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICBzICs9IFwiIFwiICsgYXR0cnNbaV0ubmFtZSArIFwiPVwiICsgd3JhcFF1b3RlcyhxdW90ZShhdHRyc1tpXS52YWx1ZSksIFwiZG91YmxlXCIsIG9wdHMpO1xuICAgICAgICB9XG4gICAgICAgIHMgKz0gXCI+XCI7XG4gICAgICAgIGlmIChvYmouY2hpbGROb2RlcyAmJiBvYmouY2hpbGROb2Rlcy5sZW5ndGgpIHtcbiAgICAgICAgICBzICs9IFwiLi4uXCI7XG4gICAgICAgIH1cbiAgICAgICAgcyArPSBcIjwvXCIgKyAkdG9Mb3dlckNhc2UuY2FsbChTdHJpbmcob2JqLm5vZGVOYW1lKSkgKyBcIj5cIjtcbiAgICAgICAgcmV0dXJuIHM7XG4gICAgICB9XG4gICAgICBpZiAoaXNBcnJheShvYmopKSB7XG4gICAgICAgIGlmIChvYmoubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgcmV0dXJuIFwiW11cIjtcbiAgICAgICAgfVxuICAgICAgICB2YXIgeHMgPSBhcnJPYmpLZXlzKG9iaiwgaW5zcGVjdDMpO1xuICAgICAgICBpZiAoaW5kZW50ICYmICFzaW5nbGVMaW5lVmFsdWVzKHhzKSkge1xuICAgICAgICAgIHJldHVybiBcIltcIiArIGluZGVudGVkSm9pbih4cywgaW5kZW50KSArIFwiXVwiO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBcIlsgXCIgKyAkam9pbi5jYWxsKHhzLCBcIiwgXCIpICsgXCIgXVwiO1xuICAgICAgfVxuICAgICAgaWYgKGlzRXJyb3Iob2JqKSkge1xuICAgICAgICB2YXIgcGFydHMgPSBhcnJPYmpLZXlzKG9iaiwgaW5zcGVjdDMpO1xuICAgICAgICBpZiAoIShcImNhdXNlXCIgaW4gRXJyb3IucHJvdG90eXBlKSAmJiBcImNhdXNlXCIgaW4gb2JqICYmICFpc0VudW1lcmFibGUuY2FsbChvYmosIFwiY2F1c2VcIikpIHtcbiAgICAgICAgICByZXR1cm4gXCJ7IFtcIiArIFN0cmluZyhvYmopICsgXCJdIFwiICsgJGpvaW4uY2FsbCgkY29uY2F0LmNhbGwoXCJbY2F1c2VdOiBcIiArIGluc3BlY3QzKG9iai5jYXVzZSksIHBhcnRzKSwgXCIsIFwiKSArIFwiIH1cIjtcbiAgICAgICAgfVxuICAgICAgICBpZiAocGFydHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgcmV0dXJuIFwiW1wiICsgU3RyaW5nKG9iaikgKyBcIl1cIjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gXCJ7IFtcIiArIFN0cmluZyhvYmopICsgXCJdIFwiICsgJGpvaW4uY2FsbChwYXJ0cywgXCIsIFwiKSArIFwiIH1cIjtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2Ygb2JqID09PSBcIm9iamVjdFwiICYmIGN1c3RvbUluc3BlY3QpIHtcbiAgICAgICAgaWYgKGluc3BlY3RTeW1ib2wgJiYgdHlwZW9mIG9ialtpbnNwZWN0U3ltYm9sXSA9PT0gXCJmdW5jdGlvblwiICYmIHV0aWxJbnNwZWN0KSB7XG4gICAgICAgICAgcmV0dXJuIHV0aWxJbnNwZWN0KG9iaiwgeyBkZXB0aDogbWF4RGVwdGggLSBkZXB0aCB9KTtcbiAgICAgICAgfSBlbHNlIGlmIChjdXN0b21JbnNwZWN0ICE9PSBcInN5bWJvbFwiICYmIHR5cGVvZiBvYmouaW5zcGVjdCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgcmV0dXJuIG9iai5pbnNwZWN0KCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChpc01hcChvYmopKSB7XG4gICAgICAgIHZhciBtYXBQYXJ0cyA9IFtdO1xuICAgICAgICBpZiAobWFwRm9yRWFjaCkge1xuICAgICAgICAgIG1hcEZvckVhY2guY2FsbChvYmosIGZ1bmN0aW9uKHZhbHVlLCBrZXkpIHtcbiAgICAgICAgICAgIG1hcFBhcnRzLnB1c2goaW5zcGVjdDMoa2V5LCBvYmosIHRydWUpICsgXCIgPT4gXCIgKyBpbnNwZWN0Myh2YWx1ZSwgb2JqKSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNvbGxlY3Rpb25PZihcIk1hcFwiLCBtYXBTaXplLmNhbGwob2JqKSwgbWFwUGFydHMsIGluZGVudCk7XG4gICAgICB9XG4gICAgICBpZiAoaXNTZXQob2JqKSkge1xuICAgICAgICB2YXIgc2V0UGFydHMgPSBbXTtcbiAgICAgICAgaWYgKHNldEZvckVhY2gpIHtcbiAgICAgICAgICBzZXRGb3JFYWNoLmNhbGwob2JqLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgICAgc2V0UGFydHMucHVzaChpbnNwZWN0Myh2YWx1ZSwgb2JqKSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNvbGxlY3Rpb25PZihcIlNldFwiLCBzZXRTaXplLmNhbGwob2JqKSwgc2V0UGFydHMsIGluZGVudCk7XG4gICAgICB9XG4gICAgICBpZiAoaXNXZWFrTWFwKG9iaikpIHtcbiAgICAgICAgcmV0dXJuIHdlYWtDb2xsZWN0aW9uT2YoXCJXZWFrTWFwXCIpO1xuICAgICAgfVxuICAgICAgaWYgKGlzV2Vha1NldChvYmopKSB7XG4gICAgICAgIHJldHVybiB3ZWFrQ29sbGVjdGlvbk9mKFwiV2Vha1NldFwiKTtcbiAgICAgIH1cbiAgICAgIGlmIChpc1dlYWtSZWYob2JqKSkge1xuICAgICAgICByZXR1cm4gd2Vha0NvbGxlY3Rpb25PZihcIldlYWtSZWZcIik7XG4gICAgICB9XG4gICAgICBpZiAoaXNOdW1iZXIob2JqKSkge1xuICAgICAgICByZXR1cm4gbWFya0JveGVkKGluc3BlY3QzKE51bWJlcihvYmopKSk7XG4gICAgICB9XG4gICAgICBpZiAoaXNCaWdJbnQob2JqKSkge1xuICAgICAgICByZXR1cm4gbWFya0JveGVkKGluc3BlY3QzKGJpZ0ludFZhbHVlT2YuY2FsbChvYmopKSk7XG4gICAgICB9XG4gICAgICBpZiAoaXNCb29sZWFuKG9iaikpIHtcbiAgICAgICAgcmV0dXJuIG1hcmtCb3hlZChib29sZWFuVmFsdWVPZi5jYWxsKG9iaikpO1xuICAgICAgfVxuICAgICAgaWYgKGlzU3RyaW5nKG9iaikpIHtcbiAgICAgICAgcmV0dXJuIG1hcmtCb3hlZChpbnNwZWN0MyhTdHJpbmcob2JqKSkpO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgJiYgb2JqID09PSB3aW5kb3cpIHtcbiAgICAgICAgcmV0dXJuIFwieyBbb2JqZWN0IFdpbmRvd10gfVwiO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiBnbG9iYWxUaGlzICE9PSBcInVuZGVmaW5lZFwiICYmIG9iaiA9PT0gZ2xvYmFsVGhpcyB8fCB0eXBlb2YgZ2xvYmFsICE9PSBcInVuZGVmaW5lZFwiICYmIG9iaiA9PT0gZ2xvYmFsKSB7XG4gICAgICAgIHJldHVybiBcInsgW29iamVjdCBnbG9iYWxUaGlzXSB9XCI7XG4gICAgICB9XG4gICAgICBpZiAoIWlzRGF0ZShvYmopICYmICFpc1JlZ0V4cChvYmopKSB7XG4gICAgICAgIHZhciB5cyA9IGFyck9iaktleXMob2JqLCBpbnNwZWN0Myk7XG4gICAgICAgIHZhciBpc1BsYWluT2JqZWN0ID0gZ1BPID8gZ1BPKG9iaikgPT09IE9iamVjdC5wcm90b3R5cGUgOiBvYmogaW5zdGFuY2VvZiBPYmplY3QgfHwgb2JqLmNvbnN0cnVjdG9yID09PSBPYmplY3Q7XG4gICAgICAgIHZhciBwcm90b1RhZyA9IG9iaiBpbnN0YW5jZW9mIE9iamVjdCA/IFwiXCIgOiBcIm51bGwgcHJvdG90eXBlXCI7XG4gICAgICAgIHZhciBzdHJpbmdUYWcgPSAhaXNQbGFpbk9iamVjdCAmJiB0b1N0cmluZ1RhZyAmJiBPYmplY3Qob2JqKSA9PT0gb2JqICYmIHRvU3RyaW5nVGFnIGluIG9iaiA/ICRzbGljZS5jYWxsKHRvU3RyKG9iaiksIDgsIC0xKSA6IHByb3RvVGFnID8gXCJPYmplY3RcIiA6IFwiXCI7XG4gICAgICAgIHZhciBjb25zdHJ1Y3RvclRhZyA9IGlzUGxhaW5PYmplY3QgfHwgdHlwZW9mIG9iai5jb25zdHJ1Y3RvciAhPT0gXCJmdW5jdGlvblwiID8gXCJcIiA6IG9iai5jb25zdHJ1Y3Rvci5uYW1lID8gb2JqLmNvbnN0cnVjdG9yLm5hbWUgKyBcIiBcIiA6IFwiXCI7XG4gICAgICAgIHZhciB0YWcgPSBjb25zdHJ1Y3RvclRhZyArIChzdHJpbmdUYWcgfHwgcHJvdG9UYWcgPyBcIltcIiArICRqb2luLmNhbGwoJGNvbmNhdC5jYWxsKFtdLCBzdHJpbmdUYWcgfHwgW10sIHByb3RvVGFnIHx8IFtdKSwgXCI6IFwiKSArIFwiXSBcIiA6IFwiXCIpO1xuICAgICAgICBpZiAoeXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgcmV0dXJuIHRhZyArIFwie31cIjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoaW5kZW50KSB7XG4gICAgICAgICAgcmV0dXJuIHRhZyArIFwie1wiICsgaW5kZW50ZWRKb2luKHlzLCBpbmRlbnQpICsgXCJ9XCI7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRhZyArIFwieyBcIiArICRqb2luLmNhbGwoeXMsIFwiLCBcIikgKyBcIiB9XCI7XG4gICAgICB9XG4gICAgICByZXR1cm4gU3RyaW5nKG9iaik7XG4gICAgfTtcbiAgICBmdW5jdGlvbiB3cmFwUXVvdGVzKHMsIGRlZmF1bHRTdHlsZSwgb3B0cykge1xuICAgICAgdmFyIHN0eWxlID0gb3B0cy5xdW90ZVN0eWxlIHx8IGRlZmF1bHRTdHlsZTtcbiAgICAgIHZhciBxdW90ZUNoYXIgPSBxdW90ZXNbc3R5bGVdO1xuICAgICAgcmV0dXJuIHF1b3RlQ2hhciArIHMgKyBxdW90ZUNoYXI7XG4gICAgfVxuICAgIGZ1bmN0aW9uIHF1b3RlKHMpIHtcbiAgICAgIHJldHVybiAkcmVwbGFjZS5jYWxsKFN0cmluZyhzKSwgL1wiL2csIFwiJnF1b3Q7XCIpO1xuICAgIH1cbiAgICBmdW5jdGlvbiBjYW5UcnVzdFRvU3RyaW5nKG9iaikge1xuICAgICAgcmV0dXJuICF0b1N0cmluZ1RhZyB8fCAhKHR5cGVvZiBvYmogPT09IFwib2JqZWN0XCIgJiYgKHRvU3RyaW5nVGFnIGluIG9iaiB8fCB0eXBlb2Ygb2JqW3RvU3RyaW5nVGFnXSAhPT0gXCJ1bmRlZmluZWRcIikpO1xuICAgIH1cbiAgICBmdW5jdGlvbiBpc0FycmF5KG9iaikge1xuICAgICAgcmV0dXJuIHRvU3RyKG9iaikgPT09IFwiW29iamVjdCBBcnJheV1cIiAmJiBjYW5UcnVzdFRvU3RyaW5nKG9iaik7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGlzRGF0ZShvYmopIHtcbiAgICAgIHJldHVybiB0b1N0cihvYmopID09PSBcIltvYmplY3QgRGF0ZV1cIiAmJiBjYW5UcnVzdFRvU3RyaW5nKG9iaik7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGlzUmVnRXhwKG9iaikge1xuICAgICAgcmV0dXJuIHRvU3RyKG9iaikgPT09IFwiW29iamVjdCBSZWdFeHBdXCIgJiYgY2FuVHJ1c3RUb1N0cmluZyhvYmopO1xuICAgIH1cbiAgICBmdW5jdGlvbiBpc0Vycm9yKG9iaikge1xuICAgICAgcmV0dXJuIHRvU3RyKG9iaikgPT09IFwiW29iamVjdCBFcnJvcl1cIiAmJiBjYW5UcnVzdFRvU3RyaW5nKG9iaik7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGlzU3RyaW5nKG9iaikge1xuICAgICAgcmV0dXJuIHRvU3RyKG9iaikgPT09IFwiW29iamVjdCBTdHJpbmddXCIgJiYgY2FuVHJ1c3RUb1N0cmluZyhvYmopO1xuICAgIH1cbiAgICBmdW5jdGlvbiBpc051bWJlcihvYmopIHtcbiAgICAgIHJldHVybiB0b1N0cihvYmopID09PSBcIltvYmplY3QgTnVtYmVyXVwiICYmIGNhblRydXN0VG9TdHJpbmcob2JqKTtcbiAgICB9XG4gICAgZnVuY3Rpb24gaXNCb29sZWFuKG9iaikge1xuICAgICAgcmV0dXJuIHRvU3RyKG9iaikgPT09IFwiW29iamVjdCBCb29sZWFuXVwiICYmIGNhblRydXN0VG9TdHJpbmcob2JqKTtcbiAgICB9XG4gICAgZnVuY3Rpb24gaXNTeW1ib2wob2JqKSB7XG4gICAgICBpZiAoaGFzU2hhbW1lZFN5bWJvbHMpIHtcbiAgICAgICAgcmV0dXJuIG9iaiAmJiB0eXBlb2Ygb2JqID09PSBcIm9iamVjdFwiICYmIG9iaiBpbnN0YW5jZW9mIFN5bWJvbDtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2Ygb2JqID09PSBcInN5bWJvbFwiKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgaWYgKCFvYmogfHwgdHlwZW9mIG9iaiAhPT0gXCJvYmplY3RcIiB8fCAhc3ltVG9TdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgc3ltVG9TdHJpbmcuY2FsbChvYmopO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgZnVuY3Rpb24gaXNCaWdJbnQob2JqKSB7XG4gICAgICBpZiAoIW9iaiB8fCB0eXBlb2Ygb2JqICE9PSBcIm9iamVjdFwiIHx8ICFiaWdJbnRWYWx1ZU9mKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIGJpZ0ludFZhbHVlT2YuY2FsbChvYmopO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgdmFyIGhhc093bjIgPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5IHx8IGZ1bmN0aW9uKGtleSkge1xuICAgICAgcmV0dXJuIGtleSBpbiB0aGlzO1xuICAgIH07XG4gICAgZnVuY3Rpb24gaGFzKG9iaiwga2V5KSB7XG4gICAgICByZXR1cm4gaGFzT3duMi5jYWxsKG9iaiwga2V5KTtcbiAgICB9XG4gICAgZnVuY3Rpb24gdG9TdHIob2JqKSB7XG4gICAgICByZXR1cm4gb2JqZWN0VG9TdHJpbmcuY2FsbChvYmopO1xuICAgIH1cbiAgICBmdW5jdGlvbiBuYW1lT2YoZikge1xuICAgICAgaWYgKGYubmFtZSkge1xuICAgICAgICByZXR1cm4gZi5uYW1lO1xuICAgICAgfVxuICAgICAgdmFyIG0gPSAkbWF0Y2guY2FsbChmdW5jdGlvblRvU3RyaW5nLmNhbGwoZiksIC9eZnVuY3Rpb25cXHMqKFtcXHckXSspLyk7XG4gICAgICBpZiAobSkge1xuICAgICAgICByZXR1cm4gbVsxXTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBmdW5jdGlvbiBpbmRleE9mKHhzLCB4KSB7XG4gICAgICBpZiAoeHMuaW5kZXhPZikge1xuICAgICAgICByZXR1cm4geHMuaW5kZXhPZih4KTtcbiAgICAgIH1cbiAgICAgIGZvciAodmFyIGkgPSAwLCBsID0geHMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIGlmICh4c1tpXSA9PT0geCkge1xuICAgICAgICAgIHJldHVybiBpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gLTE7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGlzTWFwKHgpIHtcbiAgICAgIGlmICghbWFwU2l6ZSB8fCAheCB8fCB0eXBlb2YgeCAhPT0gXCJvYmplY3RcIikge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICBtYXBTaXplLmNhbGwoeCk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgc2V0U2l6ZS5jYWxsKHgpO1xuICAgICAgICB9IGNhdGNoIChzKSB7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHggaW5zdGFuY2VvZiBNYXA7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICB9XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGlzV2Vha01hcCh4KSB7XG4gICAgICBpZiAoIXdlYWtNYXBIYXMgfHwgIXggfHwgdHlwZW9mIHggIT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgd2Vha01hcEhhcy5jYWxsKHgsIHdlYWtNYXBIYXMpO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHdlYWtTZXRIYXMuY2FsbCh4LCB3ZWFrU2V0SGFzKTtcbiAgICAgICAgfSBjYXRjaCAocykge1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB4IGluc3RhbmNlb2YgV2Vha01hcDtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgZnVuY3Rpb24gaXNXZWFrUmVmKHgpIHtcbiAgICAgIGlmICghd2Vha1JlZkRlcmVmIHx8ICF4IHx8IHR5cGVvZiB4ICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIHdlYWtSZWZEZXJlZi5jYWxsKHgpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgZnVuY3Rpb24gaXNTZXQoeCkge1xuICAgICAgaWYgKCFzZXRTaXplIHx8ICF4IHx8IHR5cGVvZiB4ICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIHNldFNpemUuY2FsbCh4KTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBtYXBTaXplLmNhbGwoeCk7XG4gICAgICAgIH0gY2F0Y2ggKG0pIHtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geCBpbnN0YW5jZW9mIFNldDtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgZnVuY3Rpb24gaXNXZWFrU2V0KHgpIHtcbiAgICAgIGlmICghd2Vha1NldEhhcyB8fCAheCB8fCB0eXBlb2YgeCAhPT0gXCJvYmplY3RcIikge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICB3ZWFrU2V0SGFzLmNhbGwoeCwgd2Vha1NldEhhcyk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgd2Vha01hcEhhcy5jYWxsKHgsIHdlYWtNYXBIYXMpO1xuICAgICAgICB9IGNhdGNoIChzKSB7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHggaW5zdGFuY2VvZiBXZWFrU2V0O1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBmdW5jdGlvbiBpc0VsZW1lbnQoeCkge1xuICAgICAgaWYgKCF4IHx8IHR5cGVvZiB4ICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgSFRNTEVsZW1lbnQgIT09IFwidW5kZWZpbmVkXCIgJiYgeCBpbnN0YW5jZW9mIEhUTUxFbGVtZW50KSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHR5cGVvZiB4Lm5vZGVOYW1lID09PSBcInN0cmluZ1wiICYmIHR5cGVvZiB4LmdldEF0dHJpYnV0ZSA9PT0gXCJmdW5jdGlvblwiO1xuICAgIH1cbiAgICBmdW5jdGlvbiBpbnNwZWN0U3RyaW5nKHN0ciwgb3B0cykge1xuICAgICAgaWYgKHN0ci5sZW5ndGggPiBvcHRzLm1heFN0cmluZ0xlbmd0aCkge1xuICAgICAgICB2YXIgcmVtYWluaW5nID0gc3RyLmxlbmd0aCAtIG9wdHMubWF4U3RyaW5nTGVuZ3RoO1xuICAgICAgICB2YXIgdHJhaWxlciA9IFwiLi4uIFwiICsgcmVtYWluaW5nICsgXCIgbW9yZSBjaGFyYWN0ZXJcIiArIChyZW1haW5pbmcgPiAxID8gXCJzXCIgOiBcIlwiKTtcbiAgICAgICAgcmV0dXJuIGluc3BlY3RTdHJpbmcoJHNsaWNlLmNhbGwoc3RyLCAwLCBvcHRzLm1heFN0cmluZ0xlbmd0aCksIG9wdHMpICsgdHJhaWxlcjtcbiAgICAgIH1cbiAgICAgIHZhciBxdW90ZVJFID0gcXVvdGVSRXNbb3B0cy5xdW90ZVN0eWxlIHx8IFwic2luZ2xlXCJdO1xuICAgICAgcXVvdGVSRS5sYXN0SW5kZXggPSAwO1xuICAgICAgdmFyIHMgPSAkcmVwbGFjZS5jYWxsKCRyZXBsYWNlLmNhbGwoc3RyLCBxdW90ZVJFLCBcIlxcXFwkMVwiKSwgL1tcXHgwMC1cXHgxZl0vZywgbG93Ynl0ZSk7XG4gICAgICByZXR1cm4gd3JhcFF1b3RlcyhzLCBcInNpbmdsZVwiLCBvcHRzKTtcbiAgICB9XG4gICAgZnVuY3Rpb24gbG93Ynl0ZShjKSB7XG4gICAgICB2YXIgbiA9IGMuY2hhckNvZGVBdCgwKTtcbiAgICAgIHZhciB4ID0ge1xuICAgICAgICA4OiBcImJcIixcbiAgICAgICAgOTogXCJ0XCIsXG4gICAgICAgIDEwOiBcIm5cIixcbiAgICAgICAgMTI6IFwiZlwiLFxuICAgICAgICAxMzogXCJyXCJcbiAgICAgIH1bbl07XG4gICAgICBpZiAoeCkge1xuICAgICAgICByZXR1cm4gXCJcXFxcXCIgKyB4O1xuICAgICAgfVxuICAgICAgcmV0dXJuIFwiXFxcXHhcIiArIChuIDwgMTYgPyBcIjBcIiA6IFwiXCIpICsgJHRvVXBwZXJDYXNlLmNhbGwobi50b1N0cmluZygxNikpO1xuICAgIH1cbiAgICBmdW5jdGlvbiBtYXJrQm94ZWQoc3RyKSB7XG4gICAgICByZXR1cm4gXCJPYmplY3QoXCIgKyBzdHIgKyBcIilcIjtcbiAgICB9XG4gICAgZnVuY3Rpb24gd2Vha0NvbGxlY3Rpb25PZih0eXBlKSB7XG4gICAgICByZXR1cm4gdHlwZSArIFwiIHsgPyB9XCI7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGNvbGxlY3Rpb25PZih0eXBlLCBzaXplLCBlbnRyaWVzLCBpbmRlbnQpIHtcbiAgICAgIHZhciBqb2luZWRFbnRyaWVzID0gaW5kZW50ID8gaW5kZW50ZWRKb2luKGVudHJpZXMsIGluZGVudCkgOiAkam9pbi5jYWxsKGVudHJpZXMsIFwiLCBcIik7XG4gICAgICByZXR1cm4gdHlwZSArIFwiIChcIiArIHNpemUgKyBcIikge1wiICsgam9pbmVkRW50cmllcyArIFwifVwiO1xuICAgIH1cbiAgICBmdW5jdGlvbiBzaW5nbGVMaW5lVmFsdWVzKHhzKSB7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHhzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmIChpbmRleE9mKHhzW2ldLCBcIlxcblwiKSA+PSAwKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgZnVuY3Rpb24gZ2V0SW5kZW50KG9wdHMsIGRlcHRoKSB7XG4gICAgICB2YXIgYmFzZUluZGVudDtcbiAgICAgIGlmIChvcHRzLmluZGVudCA9PT0gXCJcdFwiKSB7XG4gICAgICAgIGJhc2VJbmRlbnQgPSBcIlx0XCI7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBvcHRzLmluZGVudCA9PT0gXCJudW1iZXJcIiAmJiBvcHRzLmluZGVudCA+IDApIHtcbiAgICAgICAgYmFzZUluZGVudCA9ICRqb2luLmNhbGwoQXJyYXkob3B0cy5pbmRlbnQgKyAxKSwgXCIgXCIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICByZXR1cm4ge1xuICAgICAgICBiYXNlOiBiYXNlSW5kZW50LFxuICAgICAgICBwcmV2OiAkam9pbi5jYWxsKEFycmF5KGRlcHRoICsgMSksIGJhc2VJbmRlbnQpXG4gICAgICB9O1xuICAgIH1cbiAgICBmdW5jdGlvbiBpbmRlbnRlZEpvaW4oeHMsIGluZGVudCkge1xuICAgICAgaWYgKHhzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gXCJcIjtcbiAgICAgIH1cbiAgICAgIHZhciBsaW5lSm9pbmVyID0gXCJcXG5cIiArIGluZGVudC5wcmV2ICsgaW5kZW50LmJhc2U7XG4gICAgICByZXR1cm4gbGluZUpvaW5lciArICRqb2luLmNhbGwoeHMsIFwiLFwiICsgbGluZUpvaW5lcikgKyBcIlxcblwiICsgaW5kZW50LnByZXY7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGFyck9iaktleXMob2JqLCBpbnNwZWN0Mykge1xuICAgICAgdmFyIGlzQXJyID0gaXNBcnJheShvYmopO1xuICAgICAgdmFyIHhzID0gW107XG4gICAgICBpZiAoaXNBcnIpIHtcbiAgICAgICAgeHMubGVuZ3RoID0gb2JqLmxlbmd0aDtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBvYmoubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICB4c1tpXSA9IGhhcyhvYmosIGkpID8gaW5zcGVjdDMob2JqW2ldLCBvYmopIDogXCJcIjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdmFyIHN5bXMgPSB0eXBlb2YgZ09QUyA9PT0gXCJmdW5jdGlvblwiID8gZ09QUyhvYmopIDogW107XG4gICAgICB2YXIgc3ltTWFwO1xuICAgICAgaWYgKGhhc1NoYW1tZWRTeW1ib2xzKSB7XG4gICAgICAgIHN5bU1hcCA9IHt9O1xuICAgICAgICBmb3IgKHZhciBrID0gMDsgayA8IHN5bXMubGVuZ3RoOyBrKyspIHtcbiAgICAgICAgICBzeW1NYXBbXCIkXCIgKyBzeW1zW2tdXSA9IHN5bXNba107XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICAgICAgaWYgKCFoYXMob2JqLCBrZXkpKSB7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGlzQXJyICYmIFN0cmluZyhOdW1iZXIoa2V5KSkgPT09IGtleSAmJiBrZXkgPCBvYmoubGVuZ3RoKSB7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGhhc1NoYW1tZWRTeW1ib2xzICYmIHN5bU1hcFtcIiRcIiArIGtleV0gaW5zdGFuY2VvZiBTeW1ib2wpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfSBlbHNlIGlmICgkdGVzdC5jYWxsKC9bXlxcdyRdLywga2V5KSkge1xuICAgICAgICAgIHhzLnB1c2goaW5zcGVjdDMoa2V5LCBvYmopICsgXCI6IFwiICsgaW5zcGVjdDMob2JqW2tleV0sIG9iaikpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHhzLnB1c2goa2V5ICsgXCI6IFwiICsgaW5zcGVjdDMob2JqW2tleV0sIG9iaikpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIGdPUFMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IHN5bXMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICBpZiAoaXNFbnVtZXJhYmxlLmNhbGwob2JqLCBzeW1zW2pdKSkge1xuICAgICAgICAgICAgeHMucHVzaChcIltcIiArIGluc3BlY3QzKHN5bXNbal0pICsgXCJdOiBcIiArIGluc3BlY3QzKG9ialtzeW1zW2pdXSwgb2JqKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4geHM7XG4gICAgfVxuICB9XG59KTtcblxuLy8gc3JjL2xpYi9iaW5hcnlfcmVhZGVyLnRzXG52YXIgQmluYXJ5UmVhZGVyID0gY2xhc3Mge1xuICAvKipcbiAgICogVGhlIERhdGFWaWV3IHVzZWQgdG8gcmVhZCB2YWx1ZXMgZnJvbSB0aGUgYmluYXJ5IGRhdGEuXG4gICAqXG4gICAqIE5vdGU6IFRoZSBEYXRhVmlldydzIGBieXRlT2Zmc2V0YCBpcyByZWxhdGl2ZSB0byB0aGUgYmVnaW5uaW5nIG9mIHRoZVxuICAgKiB1bmRlcmx5aW5nIEFycmF5QnVmZmVyLCBub3QgdGhlIHN0YXJ0IG9mIHRoZSBwcm92aWRlZCBVaW50OEFycmF5IGlucHV0LlxuICAgKiBUaGlzIGBCaW5hcnlSZWFkZXJgJ3MgYCNvZmZzZXRgIGZpZWxkIGlzIHVzZWQgdG8gdHJhY2sgdGhlIGN1cnJlbnQgcmVhZCBwb3NpdGlvblxuICAgKiByZWxhdGl2ZSB0byB0aGUgc3RhcnQgb2YgdGhlIHByb3ZpZGVkIFVpbnQ4QXJyYXkgaW5wdXQuXG4gICAqL1xuICB2aWV3O1xuICAvKipcbiAgICogUmVwcmVzZW50cyB0aGUgb2Zmc2V0IChpbiBieXRlcykgcmVsYXRpdmUgdG8gdGhlIHN0YXJ0IG9mIHRoZSBEYXRhVmlld1xuICAgKiBhbmQgcHJvdmlkZWQgVWludDhBcnJheSBpbnB1dC5cbiAgICpcbiAgICogTm90ZTogVGhpcyBpcyAqbm90KiB0aGUgYWJzb2x1dGUgYnl0ZSBvZmZzZXQgd2l0aGluIHRoZSB1bmRlcmx5aW5nIEFycmF5QnVmZmVyLlxuICAgKi9cbiAgb2Zmc2V0ID0gMDtcbiAgY29uc3RydWN0b3IoaW5wdXQpIHtcbiAgICB0aGlzLnZpZXcgPSBpbnB1dCBpbnN0YW5jZW9mIERhdGFWaWV3ID8gaW5wdXQgOiBuZXcgRGF0YVZpZXcoaW5wdXQuYnVmZmVyLCBpbnB1dC5ieXRlT2Zmc2V0LCBpbnB1dC5ieXRlTGVuZ3RoKTtcbiAgICB0aGlzLm9mZnNldCA9IDA7XG4gIH1cbiAgcmVzZXQoaW5wdXQpIHtcbiAgICB0aGlzLnZpZXcgPSBpbnB1dCBpbnN0YW5jZW9mIERhdGFWaWV3ID8gaW5wdXQgOiBuZXcgRGF0YVZpZXcoaW5wdXQuYnVmZmVyLCBpbnB1dC5ieXRlT2Zmc2V0LCBpbnB1dC5ieXRlTGVuZ3RoKTtcbiAgICB0aGlzLm9mZnNldCA9IDA7XG4gIH1cbiAgZ2V0IHJlbWFpbmluZygpIHtcbiAgICByZXR1cm4gdGhpcy52aWV3LmJ5dGVMZW5ndGggLSB0aGlzLm9mZnNldDtcbiAgfVxuICAvKiogRW5zdXJlIHdlIGhhdmUgYXQgbGVhc3QgYG5gIGJ5dGVzIGxlZnQgdG8gcmVhZCAqL1xuICAjZW5zdXJlKG4pIHtcbiAgICBpZiAodGhpcy5vZmZzZXQgKyBuID4gdGhpcy52aWV3LmJ5dGVMZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBSYW5nZUVycm9yKFxuICAgICAgICBgVHJpZWQgdG8gcmVhZCAke259IGJ5dGUocykgYXQgcmVsYXRpdmUgb2Zmc2V0ICR7dGhpcy5vZmZzZXR9LCBidXQgb25seSAke3RoaXMucmVtYWluaW5nfSBieXRlKHMpIHJlbWFpbmBcbiAgICAgICk7XG4gICAgfVxuICB9XG4gIHJlYWRVSW50OEFycmF5KCkge1xuICAgIGNvbnN0IGxlbmd0aCA9IHRoaXMucmVhZFUzMigpO1xuICAgIHRoaXMuI2Vuc3VyZShsZW5ndGgpO1xuICAgIHJldHVybiB0aGlzLnJlYWRCeXRlcyhsZW5ndGgpO1xuICB9XG4gIHJlYWRCb29sKCkge1xuICAgIGNvbnN0IHZhbHVlID0gdGhpcy52aWV3LmdldFVpbnQ4KHRoaXMub2Zmc2V0KTtcbiAgICB0aGlzLm9mZnNldCArPSAxO1xuICAgIHJldHVybiB2YWx1ZSAhPT0gMDtcbiAgfVxuICByZWFkQnl0ZSgpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHRoaXMudmlldy5nZXRVaW50OCh0aGlzLm9mZnNldCk7XG4gICAgdGhpcy5vZmZzZXQgKz0gMTtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cbiAgcmVhZEJ5dGVzKGxlbmd0aCkge1xuICAgIGNvbnN0IGFycmF5ID0gbmV3IFVpbnQ4QXJyYXkoXG4gICAgICB0aGlzLnZpZXcuYnVmZmVyLFxuICAgICAgdGhpcy52aWV3LmJ5dGVPZmZzZXQgKyB0aGlzLm9mZnNldCxcbiAgICAgIGxlbmd0aFxuICAgICk7XG4gICAgdGhpcy5vZmZzZXQgKz0gbGVuZ3RoO1xuICAgIHJldHVybiBhcnJheTtcbiAgfVxuICByZWFkSTgoKSB7XG4gICAgY29uc3QgdmFsdWUgPSB0aGlzLnZpZXcuZ2V0SW50OCh0aGlzLm9mZnNldCk7XG4gICAgdGhpcy5vZmZzZXQgKz0gMTtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cbiAgcmVhZFU4KCkge1xuICAgIHJldHVybiB0aGlzLnJlYWRCeXRlKCk7XG4gIH1cbiAgcmVhZEkxNigpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHRoaXMudmlldy5nZXRJbnQxNih0aGlzLm9mZnNldCwgdHJ1ZSk7XG4gICAgdGhpcy5vZmZzZXQgKz0gMjtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cbiAgcmVhZFUxNigpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHRoaXMudmlldy5nZXRVaW50MTYodGhpcy5vZmZzZXQsIHRydWUpO1xuICAgIHRoaXMub2Zmc2V0ICs9IDI7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG4gIHJlYWRJMzIoKSB7XG4gICAgY29uc3QgdmFsdWUgPSB0aGlzLnZpZXcuZ2V0SW50MzIodGhpcy5vZmZzZXQsIHRydWUpO1xuICAgIHRoaXMub2Zmc2V0ICs9IDQ7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG4gIHJlYWRVMzIoKSB7XG4gICAgY29uc3QgdmFsdWUgPSB0aGlzLnZpZXcuZ2V0VWludDMyKHRoaXMub2Zmc2V0LCB0cnVlKTtcbiAgICB0aGlzLm9mZnNldCArPSA0O1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuICByZWFkSTY0KCkge1xuICAgIGNvbnN0IHZhbHVlID0gdGhpcy52aWV3LmdldEJpZ0ludDY0KHRoaXMub2Zmc2V0LCB0cnVlKTtcbiAgICB0aGlzLm9mZnNldCArPSA4O1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuICByZWFkVTY0KCkge1xuICAgIGNvbnN0IHZhbHVlID0gdGhpcy52aWV3LmdldEJpZ1VpbnQ2NCh0aGlzLm9mZnNldCwgdHJ1ZSk7XG4gICAgdGhpcy5vZmZzZXQgKz0gODtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cbiAgcmVhZFUxMjgoKSB7XG4gICAgY29uc3QgbG93ZXJQYXJ0ID0gdGhpcy52aWV3LmdldEJpZ1VpbnQ2NCh0aGlzLm9mZnNldCwgdHJ1ZSk7XG4gICAgY29uc3QgdXBwZXJQYXJ0ID0gdGhpcy52aWV3LmdldEJpZ1VpbnQ2NCh0aGlzLm9mZnNldCArIDgsIHRydWUpO1xuICAgIHRoaXMub2Zmc2V0ICs9IDE2O1xuICAgIHJldHVybiAodXBwZXJQYXJ0IDw8IEJpZ0ludCg2NCkpICsgbG93ZXJQYXJ0O1xuICB9XG4gIHJlYWRJMTI4KCkge1xuICAgIGNvbnN0IGxvd2VyUGFydCA9IHRoaXMudmlldy5nZXRCaWdVaW50NjQodGhpcy5vZmZzZXQsIHRydWUpO1xuICAgIGNvbnN0IHVwcGVyUGFydCA9IHRoaXMudmlldy5nZXRCaWdJbnQ2NCh0aGlzLm9mZnNldCArIDgsIHRydWUpO1xuICAgIHRoaXMub2Zmc2V0ICs9IDE2O1xuICAgIHJldHVybiAodXBwZXJQYXJ0IDw8IEJpZ0ludCg2NCkpICsgbG93ZXJQYXJ0O1xuICB9XG4gIHJlYWRVMjU2KCkge1xuICAgIGNvbnN0IHAwID0gdGhpcy52aWV3LmdldEJpZ1VpbnQ2NCh0aGlzLm9mZnNldCwgdHJ1ZSk7XG4gICAgY29uc3QgcDEgPSB0aGlzLnZpZXcuZ2V0QmlnVWludDY0KHRoaXMub2Zmc2V0ICsgOCwgdHJ1ZSk7XG4gICAgY29uc3QgcDIgPSB0aGlzLnZpZXcuZ2V0QmlnVWludDY0KHRoaXMub2Zmc2V0ICsgMTYsIHRydWUpO1xuICAgIGNvbnN0IHAzID0gdGhpcy52aWV3LmdldEJpZ1VpbnQ2NCh0aGlzLm9mZnNldCArIDI0LCB0cnVlKTtcbiAgICB0aGlzLm9mZnNldCArPSAzMjtcbiAgICByZXR1cm4gKHAzIDw8IEJpZ0ludCgzICogNjQpKSArIChwMiA8PCBCaWdJbnQoMiAqIDY0KSkgKyAocDEgPDwgQmlnSW50KDEgKiA2NCkpICsgcDA7XG4gIH1cbiAgcmVhZEkyNTYoKSB7XG4gICAgY29uc3QgcDAgPSB0aGlzLnZpZXcuZ2V0QmlnVWludDY0KHRoaXMub2Zmc2V0LCB0cnVlKTtcbiAgICBjb25zdCBwMSA9IHRoaXMudmlldy5nZXRCaWdVaW50NjQodGhpcy5vZmZzZXQgKyA4LCB0cnVlKTtcbiAgICBjb25zdCBwMiA9IHRoaXMudmlldy5nZXRCaWdVaW50NjQodGhpcy5vZmZzZXQgKyAxNiwgdHJ1ZSk7XG4gICAgY29uc3QgcDMgPSB0aGlzLnZpZXcuZ2V0QmlnSW50NjQodGhpcy5vZmZzZXQgKyAyNCwgdHJ1ZSk7XG4gICAgdGhpcy5vZmZzZXQgKz0gMzI7XG4gICAgcmV0dXJuIChwMyA8PCBCaWdJbnQoMyAqIDY0KSkgKyAocDIgPDwgQmlnSW50KDIgKiA2NCkpICsgKHAxIDw8IEJpZ0ludCgxICogNjQpKSArIHAwO1xuICB9XG4gIHJlYWRGMzIoKSB7XG4gICAgY29uc3QgdmFsdWUgPSB0aGlzLnZpZXcuZ2V0RmxvYXQzMih0aGlzLm9mZnNldCwgdHJ1ZSk7XG4gICAgdGhpcy5vZmZzZXQgKz0gNDtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cbiAgcmVhZEY2NCgpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHRoaXMudmlldy5nZXRGbG9hdDY0KHRoaXMub2Zmc2V0LCB0cnVlKTtcbiAgICB0aGlzLm9mZnNldCArPSA4O1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuICByZWFkU3RyaW5nKCkge1xuICAgIGNvbnN0IHVpbnQ4QXJyYXkgPSB0aGlzLnJlYWRVSW50OEFycmF5KCk7XG4gICAgcmV0dXJuIG5ldyBUZXh0RGVjb2RlcihcInV0Zi04XCIpLmRlY29kZSh1aW50OEFycmF5KTtcbiAgfVxufTtcblxuLy8gc3JjL2xpYi9iaW5hcnlfd3JpdGVyLnRzXG52YXIgaW1wb3J0X2Jhc2U2NF9qcyA9IF9fdG9FU00ocmVxdWlyZV9iYXNlNjRfanMoKSk7XG52YXIgQXJyYXlCdWZmZXJQcm90b3R5cGVUcmFuc2ZlciA9IEFycmF5QnVmZmVyLnByb3RvdHlwZS50cmFuc2ZlciA/PyBmdW5jdGlvbihuZXdCeXRlTGVuZ3RoKSB7XG4gIGlmIChuZXdCeXRlTGVuZ3RoID09PSB2b2lkIDApIHtcbiAgICByZXR1cm4gdGhpcy5zbGljZSgpO1xuICB9IGVsc2UgaWYgKG5ld0J5dGVMZW5ndGggPD0gdGhpcy5ieXRlTGVuZ3RoKSB7XG4gICAgcmV0dXJuIHRoaXMuc2xpY2UoMCwgbmV3Qnl0ZUxlbmd0aCk7XG4gIH0gZWxzZSB7XG4gICAgY29uc3QgY29weSA9IG5ldyBVaW50OEFycmF5KG5ld0J5dGVMZW5ndGgpO1xuICAgIGNvcHkuc2V0KG5ldyBVaW50OEFycmF5KHRoaXMpKTtcbiAgICByZXR1cm4gY29weS5idWZmZXI7XG4gIH1cbn07XG52YXIgUmVzaXphYmxlQnVmZmVyID0gY2xhc3Mge1xuICBidWZmZXI7XG4gIHZpZXc7XG4gIGNvbnN0cnVjdG9yKGluaXQpIHtcbiAgICB0aGlzLmJ1ZmZlciA9IHR5cGVvZiBpbml0ID09PSBcIm51bWJlclwiID8gbmV3IEFycmF5QnVmZmVyKGluaXQpIDogaW5pdDtcbiAgICB0aGlzLnZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIpO1xuICB9XG4gIGdldCBjYXBhY2l0eSgpIHtcbiAgICByZXR1cm4gdGhpcy5idWZmZXIuYnl0ZUxlbmd0aDtcbiAgfVxuICBncm93KG5ld1NpemUpIHtcbiAgICBpZiAobmV3U2l6ZSA8PSB0aGlzLmJ1ZmZlci5ieXRlTGVuZ3RoKSByZXR1cm47XG4gICAgdGhpcy5idWZmZXIgPSBBcnJheUJ1ZmZlclByb3RvdHlwZVRyYW5zZmVyLmNhbGwodGhpcy5idWZmZXIsIG5ld1NpemUpO1xuICAgIHRoaXMudmlldyA9IG5ldyBEYXRhVmlldyh0aGlzLmJ1ZmZlcik7XG4gIH1cbn07XG52YXIgQmluYXJ5V3JpdGVyID0gY2xhc3Mge1xuICBidWZmZXI7XG4gIG9mZnNldCA9IDA7XG4gIGNvbnN0cnVjdG9yKGluaXQpIHtcbiAgICB0aGlzLmJ1ZmZlciA9IHR5cGVvZiBpbml0ID09PSBcIm51bWJlclwiID8gbmV3IFJlc2l6YWJsZUJ1ZmZlcihpbml0KSA6IGluaXQ7XG4gIH1cbiAgY2xlYXIoKSB7XG4gICAgdGhpcy5vZmZzZXQgPSAwO1xuICB9XG4gIHJlc2V0KGJ1ZmZlcikge1xuICAgIHRoaXMuYnVmZmVyID0gYnVmZmVyO1xuICAgIHRoaXMub2Zmc2V0ID0gMDtcbiAgfVxuICBleHBhbmRCdWZmZXIoYWRkaXRpb25hbENhcGFjaXR5KSB7XG4gICAgY29uc3QgbWluQ2FwYWNpdHkgPSB0aGlzLm9mZnNldCArIGFkZGl0aW9uYWxDYXBhY2l0eSArIDE7XG4gICAgaWYgKG1pbkNhcGFjaXR5IDw9IHRoaXMuYnVmZmVyLmNhcGFjaXR5KSByZXR1cm47XG4gICAgbGV0IG5ld0NhcGFjaXR5ID0gdGhpcy5idWZmZXIuY2FwYWNpdHkgKiAyO1xuICAgIGlmIChuZXdDYXBhY2l0eSA8IG1pbkNhcGFjaXR5KSBuZXdDYXBhY2l0eSA9IG1pbkNhcGFjaXR5O1xuICAgIHRoaXMuYnVmZmVyLmdyb3cobmV3Q2FwYWNpdHkpO1xuICB9XG4gIHRvQmFzZTY0KCkge1xuICAgIHJldHVybiAoMCwgaW1wb3J0X2Jhc2U2NF9qcy5mcm9tQnl0ZUFycmF5KSh0aGlzLmdldEJ1ZmZlcigpKTtcbiAgfVxuICBnZXRCdWZmZXIoKSB7XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KHRoaXMuYnVmZmVyLmJ1ZmZlciwgMCwgdGhpcy5vZmZzZXQpO1xuICB9XG4gIGdldCB2aWV3KCkge1xuICAgIHJldHVybiB0aGlzLmJ1ZmZlci52aWV3O1xuICB9XG4gIHdyaXRlVUludDhBcnJheSh2YWx1ZSkge1xuICAgIGNvbnN0IGxlbmd0aCA9IHZhbHVlLmxlbmd0aDtcbiAgICB0aGlzLmV4cGFuZEJ1ZmZlcig0ICsgbGVuZ3RoKTtcbiAgICB0aGlzLndyaXRlVTMyKGxlbmd0aCk7XG4gICAgbmV3IFVpbnQ4QXJyYXkodGhpcy5idWZmZXIuYnVmZmVyLCB0aGlzLm9mZnNldCkuc2V0KHZhbHVlKTtcbiAgICB0aGlzLm9mZnNldCArPSBsZW5ndGg7XG4gIH1cbiAgd3JpdGVCb29sKHZhbHVlKSB7XG4gICAgdGhpcy5leHBhbmRCdWZmZXIoMSk7XG4gICAgdGhpcy52aWV3LnNldFVpbnQ4KHRoaXMub2Zmc2V0LCB2YWx1ZSA/IDEgOiAwKTtcbiAgICB0aGlzLm9mZnNldCArPSAxO1xuICB9XG4gIHdyaXRlQnl0ZSh2YWx1ZSkge1xuICAgIHRoaXMuZXhwYW5kQnVmZmVyKDEpO1xuICAgIHRoaXMudmlldy5zZXRVaW50OCh0aGlzLm9mZnNldCwgdmFsdWUpO1xuICAgIHRoaXMub2Zmc2V0ICs9IDE7XG4gIH1cbiAgd3JpdGVCeXRlcyh2YWx1ZSkge1xuICAgIHRoaXMuZXhwYW5kQnVmZmVyKHZhbHVlLmxlbmd0aCk7XG4gICAgbmV3IFVpbnQ4QXJyYXkodGhpcy5idWZmZXIuYnVmZmVyLCB0aGlzLm9mZnNldCwgdmFsdWUubGVuZ3RoKS5zZXQodmFsdWUpO1xuICAgIHRoaXMub2Zmc2V0ICs9IHZhbHVlLmxlbmd0aDtcbiAgfVxuICB3cml0ZUk4KHZhbHVlKSB7XG4gICAgdGhpcy5leHBhbmRCdWZmZXIoMSk7XG4gICAgdGhpcy52aWV3LnNldEludDgodGhpcy5vZmZzZXQsIHZhbHVlKTtcbiAgICB0aGlzLm9mZnNldCArPSAxO1xuICB9XG4gIHdyaXRlVTgodmFsdWUpIHtcbiAgICB0aGlzLmV4cGFuZEJ1ZmZlcigxKTtcbiAgICB0aGlzLnZpZXcuc2V0VWludDgodGhpcy5vZmZzZXQsIHZhbHVlKTtcbiAgICB0aGlzLm9mZnNldCArPSAxO1xuICB9XG4gIHdyaXRlSTE2KHZhbHVlKSB7XG4gICAgdGhpcy5leHBhbmRCdWZmZXIoMik7XG4gICAgdGhpcy52aWV3LnNldEludDE2KHRoaXMub2Zmc2V0LCB2YWx1ZSwgdHJ1ZSk7XG4gICAgdGhpcy5vZmZzZXQgKz0gMjtcbiAgfVxuICB3cml0ZVUxNih2YWx1ZSkge1xuICAgIHRoaXMuZXhwYW5kQnVmZmVyKDIpO1xuICAgIHRoaXMudmlldy5zZXRVaW50MTYodGhpcy5vZmZzZXQsIHZhbHVlLCB0cnVlKTtcbiAgICB0aGlzLm9mZnNldCArPSAyO1xuICB9XG4gIHdyaXRlSTMyKHZhbHVlKSB7XG4gICAgdGhpcy5leHBhbmRCdWZmZXIoNCk7XG4gICAgdGhpcy52aWV3LnNldEludDMyKHRoaXMub2Zmc2V0LCB2YWx1ZSwgdHJ1ZSk7XG4gICAgdGhpcy5vZmZzZXQgKz0gNDtcbiAgfVxuICB3cml0ZVUzMih2YWx1ZSkge1xuICAgIHRoaXMuZXhwYW5kQnVmZmVyKDQpO1xuICAgIHRoaXMudmlldy5zZXRVaW50MzIodGhpcy5vZmZzZXQsIHZhbHVlLCB0cnVlKTtcbiAgICB0aGlzLm9mZnNldCArPSA0O1xuICB9XG4gIHdyaXRlSTY0KHZhbHVlKSB7XG4gICAgdGhpcy5leHBhbmRCdWZmZXIoOCk7XG4gICAgdGhpcy52aWV3LnNldEJpZ0ludDY0KHRoaXMub2Zmc2V0LCB2YWx1ZSwgdHJ1ZSk7XG4gICAgdGhpcy5vZmZzZXQgKz0gODtcbiAgfVxuICB3cml0ZVU2NCh2YWx1ZSkge1xuICAgIHRoaXMuZXhwYW5kQnVmZmVyKDgpO1xuICAgIHRoaXMudmlldy5zZXRCaWdVaW50NjQodGhpcy5vZmZzZXQsIHZhbHVlLCB0cnVlKTtcbiAgICB0aGlzLm9mZnNldCArPSA4O1xuICB9XG4gIHdyaXRlVTEyOCh2YWx1ZSkge1xuICAgIHRoaXMuZXhwYW5kQnVmZmVyKDE2KTtcbiAgICBjb25zdCBsb3dlclBhcnQgPSB2YWx1ZSAmIEJpZ0ludChcIjB4RkZGRkZGRkZGRkZGRkZGRlwiKTtcbiAgICBjb25zdCB1cHBlclBhcnQgPSB2YWx1ZSA+PiBCaWdJbnQoNjQpO1xuICAgIHRoaXMudmlldy5zZXRCaWdVaW50NjQodGhpcy5vZmZzZXQsIGxvd2VyUGFydCwgdHJ1ZSk7XG4gICAgdGhpcy52aWV3LnNldEJpZ1VpbnQ2NCh0aGlzLm9mZnNldCArIDgsIHVwcGVyUGFydCwgdHJ1ZSk7XG4gICAgdGhpcy5vZmZzZXQgKz0gMTY7XG4gIH1cbiAgd3JpdGVJMTI4KHZhbHVlKSB7XG4gICAgdGhpcy5leHBhbmRCdWZmZXIoMTYpO1xuICAgIGNvbnN0IGxvd2VyUGFydCA9IHZhbHVlICYgQmlnSW50KFwiMHhGRkZGRkZGRkZGRkZGRkZGXCIpO1xuICAgIGNvbnN0IHVwcGVyUGFydCA9IHZhbHVlID4+IEJpZ0ludCg2NCk7XG4gICAgdGhpcy52aWV3LnNldEJpZ0ludDY0KHRoaXMub2Zmc2V0LCBsb3dlclBhcnQsIHRydWUpO1xuICAgIHRoaXMudmlldy5zZXRCaWdJbnQ2NCh0aGlzLm9mZnNldCArIDgsIHVwcGVyUGFydCwgdHJ1ZSk7XG4gICAgdGhpcy5vZmZzZXQgKz0gMTY7XG4gIH1cbiAgd3JpdGVVMjU2KHZhbHVlKSB7XG4gICAgdGhpcy5leHBhbmRCdWZmZXIoMzIpO1xuICAgIGNvbnN0IGxvd182NF9tYXNrID0gQmlnSW50KFwiMHhGRkZGRkZGRkZGRkZGRkZGXCIpO1xuICAgIGNvbnN0IHAwID0gdmFsdWUgJiBsb3dfNjRfbWFzaztcbiAgICBjb25zdCBwMSA9IHZhbHVlID4+IEJpZ0ludCg2NCAqIDEpICYgbG93XzY0X21hc2s7XG4gICAgY29uc3QgcDIgPSB2YWx1ZSA+PiBCaWdJbnQoNjQgKiAyKSAmIGxvd182NF9tYXNrO1xuICAgIGNvbnN0IHAzID0gdmFsdWUgPj4gQmlnSW50KDY0ICogMyk7XG4gICAgdGhpcy52aWV3LnNldEJpZ1VpbnQ2NCh0aGlzLm9mZnNldCArIDggKiAwLCBwMCwgdHJ1ZSk7XG4gICAgdGhpcy52aWV3LnNldEJpZ1VpbnQ2NCh0aGlzLm9mZnNldCArIDggKiAxLCBwMSwgdHJ1ZSk7XG4gICAgdGhpcy52aWV3LnNldEJpZ1VpbnQ2NCh0aGlzLm9mZnNldCArIDggKiAyLCBwMiwgdHJ1ZSk7XG4gICAgdGhpcy52aWV3LnNldEJpZ1VpbnQ2NCh0aGlzLm9mZnNldCArIDggKiAzLCBwMywgdHJ1ZSk7XG4gICAgdGhpcy5vZmZzZXQgKz0gMzI7XG4gIH1cbiAgd3JpdGVJMjU2KHZhbHVlKSB7XG4gICAgdGhpcy5leHBhbmRCdWZmZXIoMzIpO1xuICAgIGNvbnN0IGxvd182NF9tYXNrID0gQmlnSW50KFwiMHhGRkZGRkZGRkZGRkZGRkZGXCIpO1xuICAgIGNvbnN0IHAwID0gdmFsdWUgJiBsb3dfNjRfbWFzaztcbiAgICBjb25zdCBwMSA9IHZhbHVlID4+IEJpZ0ludCg2NCAqIDEpICYgbG93XzY0X21hc2s7XG4gICAgY29uc3QgcDIgPSB2YWx1ZSA+PiBCaWdJbnQoNjQgKiAyKSAmIGxvd182NF9tYXNrO1xuICAgIGNvbnN0IHAzID0gdmFsdWUgPj4gQmlnSW50KDY0ICogMyk7XG4gICAgdGhpcy52aWV3LnNldEJpZ1VpbnQ2NCh0aGlzLm9mZnNldCArIDggKiAwLCBwMCwgdHJ1ZSk7XG4gICAgdGhpcy52aWV3LnNldEJpZ1VpbnQ2NCh0aGlzLm9mZnNldCArIDggKiAxLCBwMSwgdHJ1ZSk7XG4gICAgdGhpcy52aWV3LnNldEJpZ1VpbnQ2NCh0aGlzLm9mZnNldCArIDggKiAyLCBwMiwgdHJ1ZSk7XG4gICAgdGhpcy52aWV3LnNldEJpZ0ludDY0KHRoaXMub2Zmc2V0ICsgOCAqIDMsIHAzLCB0cnVlKTtcbiAgICB0aGlzLm9mZnNldCArPSAzMjtcbiAgfVxuICB3cml0ZUYzMih2YWx1ZSkge1xuICAgIHRoaXMuZXhwYW5kQnVmZmVyKDQpO1xuICAgIHRoaXMudmlldy5zZXRGbG9hdDMyKHRoaXMub2Zmc2V0LCB2YWx1ZSwgdHJ1ZSk7XG4gICAgdGhpcy5vZmZzZXQgKz0gNDtcbiAgfVxuICB3cml0ZUY2NCh2YWx1ZSkge1xuICAgIHRoaXMuZXhwYW5kQnVmZmVyKDgpO1xuICAgIHRoaXMudmlldy5zZXRGbG9hdDY0KHRoaXMub2Zmc2V0LCB2YWx1ZSwgdHJ1ZSk7XG4gICAgdGhpcy5vZmZzZXQgKz0gODtcbiAgfVxuICB3cml0ZVN0cmluZyh2YWx1ZSkge1xuICAgIGNvbnN0IGVuY29kZXIgPSBuZXcgVGV4dEVuY29kZXIoKTtcbiAgICBjb25zdCBlbmNvZGVkU3RyaW5nID0gZW5jb2Rlci5lbmNvZGUodmFsdWUpO1xuICAgIHRoaXMud3JpdGVVSW50OEFycmF5KGVuY29kZWRTdHJpbmcpO1xuICB9XG59O1xuXG4vLyBzcmMvbGliL3V0aWwudHNcbmZ1bmN0aW9uIHVpbnQ4QXJyYXlUb0hleFN0cmluZyhhcnJheSkge1xuICByZXR1cm4gQXJyYXkucHJvdG90eXBlLm1hcC5jYWxsKGFycmF5LnJldmVyc2UoKSwgKHgpID0+IChcIjAwXCIgKyB4LnRvU3RyaW5nKDE2KSkuc2xpY2UoLTIpKS5qb2luKFwiXCIpO1xufVxuZnVuY3Rpb24gdWludDhBcnJheVRvVTEyOChhcnJheSkge1xuICBpZiAoYXJyYXkubGVuZ3RoICE9IDE2KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVaW50OEFycmF5IGlzIG5vdCAxNiBieXRlcyBsb25nOiAke2FycmF5fWApO1xuICB9XG4gIHJldHVybiBuZXcgQmluYXJ5UmVhZGVyKGFycmF5KS5yZWFkVTEyOCgpO1xufVxuZnVuY3Rpb24gdWludDhBcnJheVRvVTI1NihhcnJheSkge1xuICBpZiAoYXJyYXkubGVuZ3RoICE9IDMyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVaW50OEFycmF5IGlzIG5vdCAzMiBieXRlcyBsb25nOiBbJHthcnJheX1dYCk7XG4gIH1cbiAgcmV0dXJuIG5ldyBCaW5hcnlSZWFkZXIoYXJyYXkpLnJlYWRVMjU2KCk7XG59XG5mdW5jdGlvbiBoZXhTdHJpbmdUb1VpbnQ4QXJyYXkoc3RyKSB7XG4gIGlmIChzdHIuc3RhcnRzV2l0aChcIjB4XCIpKSB7XG4gICAgc3RyID0gc3RyLnNsaWNlKDIpO1xuICB9XG4gIGNvbnN0IG1hdGNoZXMgPSBzdHIubWF0Y2goLy57MSwyfS9nKSB8fCBbXTtcbiAgY29uc3QgZGF0YSA9IFVpbnQ4QXJyYXkuZnJvbShcbiAgICBtYXRjaGVzLm1hcCgoYnl0ZSkgPT4gcGFyc2VJbnQoYnl0ZSwgMTYpKVxuICApO1xuICByZXR1cm4gZGF0YS5yZXZlcnNlKCk7XG59XG5mdW5jdGlvbiBoZXhTdHJpbmdUb1UxMjgoc3RyKSB7XG4gIHJldHVybiB1aW50OEFycmF5VG9VMTI4KGhleFN0cmluZ1RvVWludDhBcnJheShzdHIpKTtcbn1cbmZ1bmN0aW9uIGhleFN0cmluZ1RvVTI1NihzdHIpIHtcbiAgcmV0dXJuIHVpbnQ4QXJyYXlUb1UyNTYoaGV4U3RyaW5nVG9VaW50OEFycmF5KHN0cikpO1xufVxuZnVuY3Rpb24gdTEyOFRvVWludDhBcnJheShkYXRhKSB7XG4gIGNvbnN0IHdyaXRlciA9IG5ldyBCaW5hcnlXcml0ZXIoMTYpO1xuICB3cml0ZXIud3JpdGVVMTI4KGRhdGEpO1xuICByZXR1cm4gd3JpdGVyLmdldEJ1ZmZlcigpO1xufVxuZnVuY3Rpb24gdTEyOFRvSGV4U3RyaW5nKGRhdGEpIHtcbiAgcmV0dXJuIHVpbnQ4QXJyYXlUb0hleFN0cmluZyh1MTI4VG9VaW50OEFycmF5KGRhdGEpKTtcbn1cbmZ1bmN0aW9uIHUyNTZUb1VpbnQ4QXJyYXkoZGF0YSkge1xuICBjb25zdCB3cml0ZXIgPSBuZXcgQmluYXJ5V3JpdGVyKDMyKTtcbiAgd3JpdGVyLndyaXRlVTI1NihkYXRhKTtcbiAgcmV0dXJuIHdyaXRlci5nZXRCdWZmZXIoKTtcbn1cbmZ1bmN0aW9uIHUyNTZUb0hleFN0cmluZyhkYXRhKSB7XG4gIHJldHVybiB1aW50OEFycmF5VG9IZXhTdHJpbmcodTI1NlRvVWludDhBcnJheShkYXRhKSk7XG59XG5mdW5jdGlvbiBjb2VyY2VUb0JpZ0ludCh2YWx1ZSwgd2hhdCkge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcImJpZ2ludFwiKSByZXR1cm4gdmFsdWU7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiBCaWdJbnQodmFsdWUpO1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLnRyaW0oKSAhPT0gXCJcIikgcmV0dXJuIEJpZ0ludCh2YWx1ZSk7XG4gIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgYENhbm5vdCBjb252ZXJ0ICR7dHlwZW9mIHZhbHVlfSB0byAke3doYXR9OiBleHBlY3RlZCBiaWdpbnQsIGludGVnZXIgbnVtYmVyLCBvciBkZWNpbWFsIHN0cmluZ2BcbiAgKTtcbn1cbmZ1bmN0aW9uIHRvUGFzY2FsQ2FzZShzKSB7XG4gIGNvbnN0IHN0ciA9IHRvQ2FtZWxDYXNlKHMpO1xuICByZXR1cm4gc3RyLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgc3RyLnNsaWNlKDEpO1xufVxuZnVuY3Rpb24gdG9DYW1lbENhc2Uocykge1xuICBjb25zdCBzdHIgPSBzLnJlcGxhY2UoL1stX10rL2csIFwiX1wiKS5yZXBsYWNlKC9fKFthLXpBLVowLTldKS9nLCAoXywgYykgPT4gYy50b1VwcGVyQ2FzZSgpKTtcbiAgcmV0dXJuIHN0ci5jaGFyQXQoMCkudG9Mb3dlckNhc2UoKSArIHN0ci5zbGljZSgxKTtcbn1cbmZ1bmN0aW9uIGJzYXRuQmFzZVNpemUodHlwZXNwYWNlLCB0eSkge1xuICBjb25zdCBhc3N1bWVkQXJyYXlMZW5ndGggPSA0O1xuICB3aGlsZSAodHkudGFnID09PSBcIlJlZlwiKSB0eSA9IHR5cGVzcGFjZS50eXBlc1t0eS52YWx1ZV07XG4gIGlmICh0eS50YWcgPT09IFwiUHJvZHVjdFwiKSB7XG4gICAgbGV0IHN1bSA9IDA7XG4gICAgZm9yIChjb25zdCB7IGFsZ2VicmFpY1R5cGU6IGVsZW0gfSBvZiB0eS52YWx1ZS5lbGVtZW50cykge1xuICAgICAgc3VtICs9IGJzYXRuQmFzZVNpemUodHlwZXNwYWNlLCBlbGVtKTtcbiAgICB9XG4gICAgcmV0dXJuIHN1bTtcbiAgfSBlbHNlIGlmICh0eS50YWcgPT09IFwiU3VtXCIpIHtcbiAgICBsZXQgbWluID0gSW5maW5pdHk7XG4gICAgZm9yIChjb25zdCB7IGFsZ2VicmFpY1R5cGU6IHZhcmkgfSBvZiB0eS52YWx1ZS52YXJpYW50cykge1xuICAgICAgY29uc3QgdlNpemUgPSBic2F0bkJhc2VTaXplKHR5cGVzcGFjZSwgdmFyaSk7XG4gICAgICBpZiAodlNpemUgPCBtaW4pIG1pbiA9IHZTaXplO1xuICAgIH1cbiAgICBpZiAobWluID09PSBJbmZpbml0eSkgbWluID0gMDtcbiAgICByZXR1cm4gNCArIG1pbjtcbiAgfSBlbHNlIGlmICh0eS50YWcgPT0gXCJBcnJheVwiKSB7XG4gICAgcmV0dXJuIDQgKyBhc3N1bWVkQXJyYXlMZW5ndGggKiBic2F0bkJhc2VTaXplKHR5cGVzcGFjZSwgdHkudmFsdWUpO1xuICB9XG4gIHJldHVybiB7XG4gICAgU3RyaW5nOiA0ICsgYXNzdW1lZEFycmF5TGVuZ3RoLFxuICAgIFN1bTogMSxcbiAgICBCb29sOiAxLFxuICAgIEk4OiAxLFxuICAgIFU4OiAxLFxuICAgIEkxNjogMixcbiAgICBVMTY6IDIsXG4gICAgSTMyOiA0LFxuICAgIFUzMjogNCxcbiAgICBGMzI6IDQsXG4gICAgSTY0OiA4LFxuICAgIFU2NDogOCxcbiAgICBGNjQ6IDgsXG4gICAgSTEyODogMTYsXG4gICAgVTEyODogMTYsXG4gICAgSTI1NjogMzIsXG4gICAgVTI1NjogMzJcbiAgfVt0eS50YWddO1xufVxudmFyIGhhc093biA9IE9iamVjdC5oYXNPd247XG5cbi8vIHNyYy9saWIvdGltZV9kdXJhdGlvbi50c1xudmFyIFRpbWVEdXJhdGlvbiA9IGNsYXNzIF9UaW1lRHVyYXRpb24ge1xuICBfX3RpbWVfZHVyYXRpb25fbWljcm9zX187XG4gIHN0YXRpYyBNSUNST1NfUEVSX01JTExJUyA9IDEwMDBuO1xuICAvKipcbiAgICogR2V0IHRoZSBhbGdlYnJhaWMgdHlwZSByZXByZXNlbnRhdGlvbiBvZiB0aGUge0BsaW5rIFRpbWVEdXJhdGlvbn0gdHlwZS5cbiAgICogQHJldHVybnMgVGhlIGFsZ2VicmFpYyB0eXBlIHJlcHJlc2VudGF0aW9uIG9mIHRoZSB0eXBlLlxuICAgKi9cbiAgc3RhdGljIGdldEFsZ2VicmFpY1R5cGUoKSB7XG4gICAgcmV0dXJuIEFsZ2VicmFpY1R5cGUuUHJvZHVjdCh7XG4gICAgICBlbGVtZW50czogW1xuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogXCJfX3RpbWVfZHVyYXRpb25fbWljcm9zX19cIixcbiAgICAgICAgICBhbGdlYnJhaWNUeXBlOiBBbGdlYnJhaWNUeXBlLkk2NFxuICAgICAgICB9XG4gICAgICBdXG4gICAgfSk7XG4gIH1cbiAgc3RhdGljIGlzVGltZUR1cmF0aW9uKGFsZ2VicmFpY1R5cGUpIHtcbiAgICBpZiAoYWxnZWJyYWljVHlwZS50YWcgIT09IFwiUHJvZHVjdFwiKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnN0IGVsZW1lbnRzID0gYWxnZWJyYWljVHlwZS52YWx1ZS5lbGVtZW50cztcbiAgICBpZiAoZWxlbWVudHMubGVuZ3RoICE9PSAxKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnN0IG1pY3Jvc0VsZW1lbnQgPSBlbGVtZW50c1swXTtcbiAgICByZXR1cm4gbWljcm9zRWxlbWVudC5uYW1lID09PSBcIl9fdGltZV9kdXJhdGlvbl9taWNyb3NfX1wiICYmIG1pY3Jvc0VsZW1lbnQuYWxnZWJyYWljVHlwZS50YWcgPT09IFwiSTY0XCI7XG4gIH1cbiAgZ2V0IG1pY3JvcygpIHtcbiAgICByZXR1cm4gdGhpcy5fX3RpbWVfZHVyYXRpb25fbWljcm9zX187XG4gIH1cbiAgZ2V0IG1pbGxpcygpIHtcbiAgICByZXR1cm4gTnVtYmVyKHRoaXMubWljcm9zIC8gX1RpbWVEdXJhdGlvbi5NSUNST1NfUEVSX01JTExJUyk7XG4gIH1cbiAgY29uc3RydWN0b3IobWljcm9zKSB7XG4gICAgdGhpcy5fX3RpbWVfZHVyYXRpb25fbWljcm9zX18gPSBjb2VyY2VUb0JpZ0ludChtaWNyb3MsIFwiVGltZUR1cmF0aW9uXCIpO1xuICB9XG4gIHN0YXRpYyBmcm9tTWlsbGlzKG1pbGxpcykge1xuICAgIHJldHVybiBuZXcgX1RpbWVEdXJhdGlvbihCaWdJbnQobWlsbGlzKSAqIF9UaW1lRHVyYXRpb24uTUlDUk9TX1BFUl9NSUxMSVMpO1xuICB9XG4gIC8qKiBUaGlzIG91dHB1dHMgdGhlIHNhbWUgc3RyaW5nIGZvcm1hdCB0aGF0IHdlIHVzZSBpbiB0aGUgaG9zdCBhbmQgaW4gUnVzdCBtb2R1bGVzICovXG4gIHRvU3RyaW5nKCkge1xuICAgIGNvbnN0IG1pY3JvcyA9IHRoaXMubWljcm9zO1xuICAgIGNvbnN0IHNpZ24gPSBtaWNyb3MgPCAwID8gXCItXCIgOiBcIitcIjtcbiAgICBjb25zdCBwb3MgPSBtaWNyb3MgPCAwID8gLW1pY3JvcyA6IG1pY3JvcztcbiAgICBjb25zdCBzZWNzID0gcG9zIC8gMTAwMDAwMG47XG4gICAgY29uc3QgbWljcm9zX3JlbWFpbmluZyA9IHBvcyAlIDEwMDAwMDBuO1xuICAgIHJldHVybiBgJHtzaWdufSR7c2Vjc30uJHtTdHJpbmcobWljcm9zX3JlbWFpbmluZykucGFkU3RhcnQoNiwgXCIwXCIpfWA7XG4gIH1cbn07XG5cbi8vIHNyYy9saWIvdGltZXN0YW1wLnRzXG52YXIgVGltZXN0YW1wID0gY2xhc3MgX1RpbWVzdGFtcCB7XG4gIF9fdGltZXN0YW1wX21pY3Jvc19zaW5jZV91bml4X2Vwb2NoX187XG4gIHN0YXRpYyBNSUNST1NfUEVSX01JTExJUyA9IDEwMDBuO1xuICBnZXQgbWljcm9zU2luY2VVbml4RXBvY2goKSB7XG4gICAgcmV0dXJuIHRoaXMuX190aW1lc3RhbXBfbWljcm9zX3NpbmNlX3VuaXhfZXBvY2hfXztcbiAgfVxuICBjb25zdHJ1Y3RvcihtaWNyb3MpIHtcbiAgICB0aGlzLl9fdGltZXN0YW1wX21pY3Jvc19zaW5jZV91bml4X2Vwb2NoX18gPSBjb2VyY2VUb0JpZ0ludChcbiAgICAgIG1pY3JvcyxcbiAgICAgIFwiVGltZXN0YW1wXCJcbiAgICApO1xuICB9XG4gIC8qKlxuICAgKiBHZXQgdGhlIGFsZ2VicmFpYyB0eXBlIHJlcHJlc2VudGF0aW9uIG9mIHRoZSB7QGxpbmsgVGltZXN0YW1wfSB0eXBlLlxuICAgKiBAcmV0dXJucyBUaGUgYWxnZWJyYWljIHR5cGUgcmVwcmVzZW50YXRpb24gb2YgdGhlIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgZ2V0QWxnZWJyYWljVHlwZSgpIHtcbiAgICByZXR1cm4gQWxnZWJyYWljVHlwZS5Qcm9kdWN0KHtcbiAgICAgIGVsZW1lbnRzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiBcIl9fdGltZXN0YW1wX21pY3Jvc19zaW5jZV91bml4X2Vwb2NoX19cIixcbiAgICAgICAgICBhbGdlYnJhaWNUeXBlOiBBbGdlYnJhaWNUeXBlLkk2NFxuICAgICAgICB9XG4gICAgICBdXG4gICAgfSk7XG4gIH1cbiAgc3RhdGljIGlzVGltZXN0YW1wKGFsZ2VicmFpY1R5cGUpIHtcbiAgICBpZiAoYWxnZWJyYWljVHlwZS50YWcgIT09IFwiUHJvZHVjdFwiKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnN0IGVsZW1lbnRzID0gYWxnZWJyYWljVHlwZS52YWx1ZS5lbGVtZW50cztcbiAgICBpZiAoZWxlbWVudHMubGVuZ3RoICE9PSAxKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnN0IG1pY3Jvc0VsZW1lbnQgPSBlbGVtZW50c1swXTtcbiAgICByZXR1cm4gbWljcm9zRWxlbWVudC5uYW1lID09PSBcIl9fdGltZXN0YW1wX21pY3Jvc19zaW5jZV91bml4X2Vwb2NoX19cIiAmJiBtaWNyb3NFbGVtZW50LmFsZ2VicmFpY1R5cGUudGFnID09PSBcIkk2NFwiO1xuICB9XG4gIC8qKlxuICAgKiBUaGUgVW5peCBlcG9jaCwgdGhlIG1pZG5pZ2h0IGF0IHRoZSBiZWdpbm5pbmcgb2YgSmFudWFyeSAxLCAxOTcwLCBVVEMuXG4gICAqL1xuICBzdGF0aWMgVU5JWF9FUE9DSCA9IG5ldyBfVGltZXN0YW1wKDBuKTtcbiAgLyoqXG4gICAqIEdldCBhIGBUaW1lc3RhbXBgIHJlcHJlc2VudGluZyB0aGUgZXhlY3V0aW9uIGVudmlyb25tZW50J3MgYmVsaWVmIG9mIHRoZSBjdXJyZW50IG1vbWVudCBpbiB0aW1lLlxuICAgKi9cbiAgc3RhdGljIG5vdygpIHtcbiAgICByZXR1cm4gX1RpbWVzdGFtcC5mcm9tRGF0ZSgvKiBAX19QVVJFX18gKi8gbmV3IERhdGUoKSk7XG4gIH1cbiAgLyoqIENvbnZlcnQgdG8gbWlsbGlzZWNvbmRzIHNpbmNlIFVuaXggZXBvY2guICovXG4gIHRvTWlsbGlzKCkge1xuICAgIHJldHVybiB0aGlzLm1pY3Jvc1NpbmNlVW5peEVwb2NoIC8gMTAwMG47XG4gIH1cbiAgLyoqXG4gICAqIEdldCBhIGBUaW1lc3RhbXBgIHJlcHJlc2VudGluZyB0aGUgc2FtZSBwb2ludCBpbiB0aW1lIGFzIGBkYXRlYC5cbiAgICovXG4gIHN0YXRpYyBmcm9tRGF0ZShkYXRlKSB7XG4gICAgY29uc3QgbWlsbGlzID0gZGF0ZS5nZXRUaW1lKCk7XG4gICAgY29uc3QgbWljcm9zID0gQmlnSW50KG1pbGxpcykgKiBfVGltZXN0YW1wLk1JQ1JPU19QRVJfTUlMTElTO1xuICAgIHJldHVybiBuZXcgX1RpbWVzdGFtcChtaWNyb3MpO1xuICB9XG4gIC8qKlxuICAgKiBHZXQgYSBgRGF0ZWAgcmVwcmVzZW50aW5nIGFwcHJveGltYXRlbHkgdGhlIHNhbWUgcG9pbnQgaW4gdGltZSBhcyBgdGhpc2AuXG4gICAqXG4gICAqIFRoaXMgbWV0aG9kIHRydW5jYXRlcyB0byBtaWxsaXNlY29uZCBwcmVjaXNpb24sXG4gICAqIGFuZCB0aHJvd3MgYFJhbmdlRXJyb3JgIGlmIHRoZSBgVGltZXN0YW1wYCBpcyBvdXRzaWRlIHRoZSByYW5nZSByZXByZXNlbnRhYmxlIGFzIGEgYERhdGVgLlxuICAgKi9cbiAgdG9EYXRlKCkge1xuICAgIGNvbnN0IG1pY3JvcyA9IHRoaXMuX190aW1lc3RhbXBfbWljcm9zX3NpbmNlX3VuaXhfZXBvY2hfXztcbiAgICBjb25zdCBtaWxsaXMgPSBtaWNyb3MgLyBfVGltZXN0YW1wLk1JQ1JPU19QRVJfTUlMTElTO1xuICAgIGlmIChtaWxsaXMgPiBCaWdJbnQoTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIpIHx8IG1pbGxpcyA8IEJpZ0ludChOdW1iZXIuTUlOX1NBRkVfSU5URUdFUikpIHtcbiAgICAgIHRocm93IG5ldyBSYW5nZUVycm9yKFxuICAgICAgICBcIlRpbWVzdGFtcCBpcyBvdXRzaWRlIG9mIHRoZSByZXByZXNlbnRhYmxlIHJhbmdlIG9mIEpTJ3MgRGF0ZVwiXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IERhdGUoTnVtYmVyKG1pbGxpcykpO1xuICB9XG4gIC8qKlxuICAgKiBHZXQgYW4gSVNPIDg2MDEgLyBSRkMgMzMzOSBmb3JtYXR0ZWQgc3RyaW5nIHJlcHJlc2VudGF0aW9uIG9mIHRoaXMgdGltZXN0YW1wIHdpdGggbWljcm9zZWNvbmQgcHJlY2lzaW9uLlxuICAgKlxuICAgKiBUaGlzIG1ldGhvZCBwcmVzZXJ2ZXMgdGhlIGZ1bGwgbWljcm9zZWNvbmQgcHJlY2lzaW9uIG9mIHRoZSB0aW1lc3RhbXAsXG4gICAqIGFuZCB0aHJvd3MgYFJhbmdlRXJyb3JgIGlmIHRoZSBgVGltZXN0YW1wYCBpcyBvdXRzaWRlIHRoZSByYW5nZSByZXByZXNlbnRhYmxlIGluIElTTyBmb3JtYXQuXG4gICAqXG4gICAqIEByZXR1cm5zIElTTyA4NjAxIGZvcm1hdHRlZCBzdHJpbmcgd2l0aCBtaWNyb3NlY29uZCBwcmVjaXNpb24gKGUuZy4sICcyMDI1LTAyLTE3VDEwOjMwOjQ1LjEyMzQ1NlonKVxuICAgKi9cbiAgdG9JU09TdHJpbmcoKSB7XG4gICAgY29uc3QgbWljcm9zID0gdGhpcy5fX3RpbWVzdGFtcF9taWNyb3Nfc2luY2VfdW5peF9lcG9jaF9fO1xuICAgIGNvbnN0IG1pbGxpcyA9IG1pY3JvcyAvIF9UaW1lc3RhbXAuTUlDUk9TX1BFUl9NSUxMSVM7XG4gICAgaWYgKG1pbGxpcyA+IEJpZ0ludChOdW1iZXIuTUFYX1NBRkVfSU5URUdFUikgfHwgbWlsbGlzIDwgQmlnSW50KE51bWJlci5NSU5fU0FGRV9JTlRFR0VSKSkge1xuICAgICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoXG4gICAgICAgIFwiVGltZXN0YW1wIGlzIG91dHNpZGUgb2YgdGhlIHJlcHJlc2VudGFibGUgcmFuZ2UgZm9yIElTTyBzdHJpbmcgZm9ybWF0dGluZ1wiXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoTnVtYmVyKG1pbGxpcykpO1xuICAgIGNvbnN0IGlzb0Jhc2UgPSBkYXRlLnRvSVNPU3RyaW5nKCk7XG4gICAgY29uc3QgbWljcm9zUmVtYWluZGVyID0gTWF0aC5hYnMoTnVtYmVyKG1pY3JvcyAlIDEwMDAwMDBuKSk7XG4gICAgY29uc3QgZnJhY3Rpb25hbFBhcnQgPSBTdHJpbmcobWljcm9zUmVtYWluZGVyKS5wYWRTdGFydCg2LCBcIjBcIik7XG4gICAgcmV0dXJuIGlzb0Jhc2UucmVwbGFjZSgvXFwuXFxkezN9WiQvLCBgLiR7ZnJhY3Rpb25hbFBhcnR9WmApO1xuICB9XG4gIHNpbmNlKG90aGVyKSB7XG4gICAgcmV0dXJuIG5ldyBUaW1lRHVyYXRpb24oXG4gICAgICB0aGlzLl9fdGltZXN0YW1wX21pY3Jvc19zaW5jZV91bml4X2Vwb2NoX18gLSBvdGhlci5fX3RpbWVzdGFtcF9taWNyb3Nfc2luY2VfdW5peF9lcG9jaF9fXG4gICAgKTtcbiAgfVxufTtcblxuLy8gc3JjL2xpYi91dWlkLnRzXG52YXIgVXVpZCA9IGNsYXNzIF9VdWlkIHtcbiAgX191dWlkX187XG4gIC8qKlxuICAgKiBUaGUgbmlsIFVVSUQgKGFsbCB6ZXJvcykuXG4gICAqXG4gICAqIEBleGFtcGxlXG4gICAqIGBgYHRzXG4gICAqIGNvbnN0IHV1aWQgPSBVdWlkLk5JTDtcbiAgICogY29uc29sZS5hc3NlcnQoXG4gICAqICAgdXVpZC50b1N0cmluZygpID09PSBcIjAwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAwMFwiXG4gICAqICk7XG4gICAqIGBgYFxuICAgKi9cbiAgc3RhdGljIE5JTCA9IG5ldyBfVXVpZCgwbik7XG4gIHN0YXRpYyBNQVhfVVVJRF9CSUdJTlQgPSAweGZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmbjtcbiAgLyoqXG4gICAqIFRoZSBtYXggVVVJRCAoYWxsIG9uZXMpLlxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0c1xuICAgKiBjb25zdCB1dWlkID0gVXVpZC5NQVg7XG4gICAqIGNvbnNvbGUuYXNzZXJ0KFxuICAgKiAgIHV1aWQudG9TdHJpbmcoKSA9PT0gXCJmZmZmZmZmZi1mZmZmLWZmZmYtZmZmZi1mZmZmZmZmZmZmZmZcIlxuICAgKiApO1xuICAgKiBgYGBcbiAgICovXG4gIHN0YXRpYyBNQVggPSBuZXcgX1V1aWQoX1V1aWQuTUFYX1VVSURfQklHSU5UKTtcbiAgLyoqXG4gICAqIENyZWF0ZSBhIFVVSUQgZnJvbSBhIHJhdyAxMjgtYml0IHZhbHVlLlxuICAgKlxuICAgKiBAcGFyYW0gdSAtIFVuc2lnbmVkIDEyOC1iaXQgaW50ZWdlclxuICAgKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIHZhbHVlIGlzIG91dHNpZGUgdGhlIHZhbGlkIFVVSUQgcmFuZ2VcbiAgICovXG4gIGNvbnN0cnVjdG9yKHUpIHtcbiAgICBjb25zdCB2ID0gY29lcmNlVG9CaWdJbnQodSwgXCJVdWlkXCIpO1xuICAgIGlmICh2IDwgMG4gfHwgdiA+IF9VdWlkLk1BWF9VVUlEX0JJR0lOVCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBVVUlEOiBtdXN0IGJlIGJldHdlZW4gMCBhbmQgYE1BWF9VVUlEX0JJR0lOVGBcIik7XG4gICAgfVxuICAgIHRoaXMuX191dWlkX18gPSB2O1xuICB9XG4gIC8qKlxuICAgKiBDcmVhdGUgYSBVVUlEIGB2NGAgZnJvbSBleHBsaWNpdCByYW5kb20gYnl0ZXMuXG4gICAqXG4gICAqIFRoaXMgbWV0aG9kIGFzc3VtZXMgdGhlIGJ5dGVzIGFyZSBhbHJlYWR5IHN1ZmZpY2llbnRseSByYW5kb20uXG4gICAqIEl0IG9ubHkgc2V0cyB0aGUgYXBwcm9wcmlhdGUgYml0cyBmb3IgdGhlIFVVSUQgdmVyc2lvbiBhbmQgdmFyaWFudC5cbiAgICpcbiAgICogQHBhcmFtIGJ5dGVzIC0gRXhhY3RseSAxNiByYW5kb20gYnl0ZXNcbiAgICogQHJldHVybnMgQSBVVUlEIGB2NGBcbiAgICogQHRocm93cyB7RXJyb3J9IElmIGBieXRlcy5sZW5ndGggIT09IDE2YFxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0c1xuICAgKiBjb25zdCByYW5kb21CeXRlcyA9IG5ldyBVaW50OEFycmF5KDE2KTtcbiAgICogY29uc3QgdXVpZCA9IFV1aWQuZnJvbVJhbmRvbUJ5dGVzVjQocmFuZG9tQnl0ZXMpO1xuICAgKlxuICAgKiBjb25zb2xlLmFzc2VydChcbiAgICogICB1dWlkLnRvU3RyaW5nKCkgPT09IFwiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAwXCJcbiAgICogKTtcbiAgICogYGBgXG4gICAqL1xuICBzdGF0aWMgZnJvbVJhbmRvbUJ5dGVzVjQoYnl0ZXMpIHtcbiAgICBpZiAoYnl0ZXMubGVuZ3RoICE9PSAxNikgdGhyb3cgbmV3IEVycm9yKFwiVVVJRCB2NCByZXF1aXJlcyAxNiBieXRlc1wiKTtcbiAgICBjb25zdCBhcnIgPSBuZXcgVWludDhBcnJheShieXRlcyk7XG4gICAgYXJyWzZdID0gYXJyWzZdICYgMTUgfCA2NDtcbiAgICBhcnJbOF0gPSBhcnJbOF0gJiA2MyB8IDEyODtcbiAgICByZXR1cm4gbmV3IF9VdWlkKF9VdWlkLmJ5dGVzVG9CaWdJbnQoYXJyKSk7XG4gIH1cbiAgLyoqXG4gICAqIEdlbmVyYXRlIGEgVVVJRCBgdjdgIHVzaW5nIGEgbW9ub3RvbmljIGNvdW50ZXIgZnJvbSBgMGAgdG8gYDJeMzEgLSAxYCxcbiAgICogYSB0aW1lc3RhbXAsIGFuZCA0IHJhbmRvbSBieXRlcy5cbiAgICpcbiAgICogVGhlIGNvdW50ZXIgd3JhcHMgYXJvdW5kIG9uIG92ZXJmbG93LlxuICAgKlxuICAgKiBUaGUgVVVJRCBgdjdgIGlzIHN0cnVjdHVyZWQgYXMgZm9sbG93czpcbiAgICpcbiAgICogYGBgYXNjaWlcbiAgICog4pSM4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSs4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSQXG4gICAqIHwgQjAgIHwgQjEgIHwgQjIgIHwgQjMgIHwgQjQgIHwgQjUgICAgICAgICAgICAgIHwgICAgICAgICBCNiAgICAgICAgfFxuICAgKiDilJzilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilLzilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilKRcbiAgICogfCAgICAgICAgICAgICAgICAgdW5peF90c19tcyAgICAgICAgICAgICAgICAgICAgfCAgICAgIHZlcnNpb24gNyAgICB8XG4gICAqIOKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUtOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmFxuICAgKiDilIzilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilKzilIDilIDilIDilIDilIDilIDilIDilIDilIDilKzilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilKzilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJBcbiAgICogfCBCNyAgICAgICAgICAgfCBCOCAgICAgIHwgQjkgIHwgQjEwIHwgQjExICB8IEIxMiB8IEIxMyB8IEIxNCB8IEIxNSB8XG4gICAqIOKUnOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUvOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUvOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUvOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUpFxuICAgKiB8IGNvdW50ZXJfaGlnaCB8IHZhcmlhbnQgfCAgICBjb3VudGVyX2xvdyAgIHwgICAgICAgIHJhbmRvbSAgICAgICAgIHxcbiAgICog4pSU4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pS04pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pS04pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pS04pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSYXG4gICAqIGBgYFxuICAgKlxuICAgKiBAcGFyYW0gY291bnRlciAtIE11dGFibGUgbW9ub3RvbmljIGNvdW50ZXIgKDMxLWJpdClcbiAgICogQHBhcmFtIG5vdyAtIFRpbWVzdGFtcCBzaW5jZSB0aGUgVW5peCBlcG9jaFxuICAgKiBAcGFyYW0gcmFuZG9tQnl0ZXMgLSBFeGFjdGx5IDQgcmFuZG9tIGJ5dGVzXG4gICAqIEByZXR1cm5zIEEgVVVJRCBgdjdgXG4gICAqXG4gICAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgYGNvdW50ZXJgIGlzIG5lZ2F0aXZlXG4gICAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgYHRpbWVzdGFtcGAgaXMgYmVmb3JlIHRoZSBVbml4IGVwb2NoXG4gICAqIEB0aHJvd3Mge0Vycm9yfSBJZiBgcmFuZG9tQnl0ZXMubGVuZ3RoICE9PSA0YFxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0c1xuICAgKiBjb25zdCBub3cgPSBUaW1lc3RhbXAuZnJvbU1pbGxpcygxXzY4Nl8wMDBfMDAwXzAwMG4pO1xuICAgKiBjb25zdCBjb3VudGVyID0geyB2YWx1ZTogMSB9O1xuICAgKiBjb25zdCByYW5kb21CeXRlcyA9IG5ldyBVaW50OEFycmF5KDQpO1xuICAgKlxuICAgKiBjb25zdCB1dWlkID0gVXVpZC5mcm9tQ291bnRlclY3KGNvdW50ZXIsIG5vdywgcmFuZG9tQnl0ZXMpO1xuICAgKlxuICAgKiBjb25zb2xlLmFzc2VydChcbiAgICogICB1dWlkLnRvU3RyaW5nKCkgPT09IFwiMDAwMDY0N2UtNTE4MC03MDAwLTgwMDAtMDAwMjAwMDAwMDAwXCJcbiAgICogKTtcbiAgICogYGBgXG4gICAqL1xuICBzdGF0aWMgZnJvbUNvdW50ZXJWNyhjb3VudGVyLCBub3csIHJhbmRvbUJ5dGVzKSB7XG4gICAgaWYgKHJhbmRvbUJ5dGVzLmxlbmd0aCAhPT0gNCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiYGZyb21Db3VudGVyVjdgIHJlcXVpcmVzIGByYW5kb21CeXRlcy5sZW5ndGggPT0gNGBcIik7XG4gICAgfVxuICAgIGlmIChjb3VudGVyLnZhbHVlIDwgMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiYGZyb21Db3VudGVyVjdgIHV1aWQgYGNvdW50ZXJgIG11c3QgYmUgbm9uLW5lZ2F0aXZlXCIpO1xuICAgIH1cbiAgICBpZiAobm93Ll9fdGltZXN0YW1wX21pY3Jvc19zaW5jZV91bml4X2Vwb2NoX18gPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJgZnJvbUNvdW50ZXJWN2AgYHRpbWVzdGFtcGAgYmVmb3JlIHVuaXggZXBvY2hcIik7XG4gICAgfVxuICAgIGNvbnN0IGNvdW50ZXJWYWwgPSBjb3VudGVyLnZhbHVlO1xuICAgIGNvdW50ZXIudmFsdWUgPSBjb3VudGVyVmFsICsgMSAmIDIxNDc0ODM2NDc7XG4gICAgY29uc3QgdHNNcyA9IG5vdy50b01pbGxpcygpICYgMHhmZmZmZmZmZmZmZmZuO1xuICAgIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoMTYpO1xuICAgIGJ5dGVzWzBdID0gTnVtYmVyKHRzTXMgPj4gNDBuICYgMHhmZm4pO1xuICAgIGJ5dGVzWzFdID0gTnVtYmVyKHRzTXMgPj4gMzJuICYgMHhmZm4pO1xuICAgIGJ5dGVzWzJdID0gTnVtYmVyKHRzTXMgPj4gMjRuICYgMHhmZm4pO1xuICAgIGJ5dGVzWzNdID0gTnVtYmVyKHRzTXMgPj4gMTZuICYgMHhmZm4pO1xuICAgIGJ5dGVzWzRdID0gTnVtYmVyKHRzTXMgPj4gOG4gJiAweGZmbik7XG4gICAgYnl0ZXNbNV0gPSBOdW1iZXIodHNNcyAmIDB4ZmZuKTtcbiAgICBieXRlc1s3XSA9IGNvdW50ZXJWYWwgPj4+IDIzICYgMjU1O1xuICAgIGJ5dGVzWzldID0gY291bnRlclZhbCA+Pj4gMTUgJiAyNTU7XG4gICAgYnl0ZXNbMTBdID0gY291bnRlclZhbCA+Pj4gNyAmIDI1NTtcbiAgICBieXRlc1sxMV0gPSAoY291bnRlclZhbCAmIDEyNykgPDwgMSAmIDI1NTtcbiAgICBieXRlc1sxMl0gfD0gcmFuZG9tQnl0ZXNbMF0gJiAxMjc7XG4gICAgYnl0ZXNbMTNdID0gcmFuZG9tQnl0ZXNbMV07XG4gICAgYnl0ZXNbMTRdID0gcmFuZG9tQnl0ZXNbMl07XG4gICAgYnl0ZXNbMTVdID0gcmFuZG9tQnl0ZXNbM107XG4gICAgYnl0ZXNbNl0gPSBieXRlc1s2XSAmIDE1IHwgMTEyO1xuICAgIGJ5dGVzWzhdID0gYnl0ZXNbOF0gJiA2MyB8IDEyODtcbiAgICByZXR1cm4gbmV3IF9VdWlkKF9VdWlkLmJ5dGVzVG9CaWdJbnQoYnl0ZXMpKTtcbiAgfVxuICAvKipcbiAgICogUGFyc2UgYSBVVUlEIGZyb20gYSBzdHJpbmcgcmVwcmVzZW50YXRpb24uXG4gICAqXG4gICAqIEBwYXJhbSBzIC0gVVVJRCBzdHJpbmdcbiAgICogQHJldHVybnMgUGFyc2VkIFVVSURcbiAgICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBzdHJpbmcgaXMgbm90IGEgdmFsaWQgVVVJRFxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0c1xuICAgKiBjb25zdCBzID0gXCIwMTg4OGQ2ZS01YzAwLTcwMDAtODAwMC0wMDAwMDAwMDAwMDBcIjtcbiAgICogY29uc3QgdXVpZCA9IFV1aWQucGFyc2Uocyk7XG4gICAqXG4gICAqIGNvbnNvbGUuYXNzZXJ0KHV1aWQudG9TdHJpbmcoKSA9PT0gcyk7XG4gICAqIGBgYFxuICAgKi9cbiAgc3RhdGljIHBhcnNlKHMpIHtcbiAgICBjb25zdCBoZXggPSBzLnJlcGxhY2UoLy0vZywgXCJcIik7XG4gICAgaWYgKGhleC5sZW5ndGggIT09IDMyKSB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIGhleCBVVUlEXCIpO1xuICAgIGxldCB2ID0gMG47XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCAzMjsgaSArPSAyKSB7XG4gICAgICB2ID0gdiA8PCA4biB8IEJpZ0ludChwYXJzZUludChoZXguc2xpY2UoaSwgaSArIDIpLCAxNikpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IF9VdWlkKHYpO1xuICB9XG4gIC8qKiBDb252ZXJ0IHRvIGhleCBzdHJpbmcgd2l0aG91dCBhIDB4IHByZWZpeC4gKi9cbiAgdG9IZXhTdHJpbmcoKSB7XG4gICAgcmV0dXJuIHUxMjhUb0hleFN0cmluZyh0aGlzLmFzQmlnSW50KCkpO1xuICB9XG4gIC8qKiBDb252ZXJ0IHRvIHN0cmluZyAoaHlwaGVuYXRlZCBmb3JtKS4gKi9cbiAgdG9TdHJpbmcoKSB7XG4gICAgY29uc3QgaGV4ID0gdGhpcy50b0hleFN0cmluZygpO1xuICAgIHJldHVybiBoZXguc2xpY2UoMCwgOCkgKyBcIi1cIiArIGhleC5zbGljZSg4LCAxMikgKyBcIi1cIiArIGhleC5zbGljZSgxMiwgMTYpICsgXCItXCIgKyBoZXguc2xpY2UoMTYsIDIwKSArIFwiLVwiICsgaGV4LnNsaWNlKDIwKTtcbiAgfVxuICAvKiogQ29udmVydCB0byBiaWdpbnQgKHUxMjgpLiAqL1xuICBhc0JpZ0ludCgpIHtcbiAgICByZXR1cm4gdGhpcy5fX3V1aWRfXztcbiAgfVxuICAvKiogUmV0dXJuIGEgYFVpbnQ4QXJyYXlgIG9mIDE2IGJ5dGVzLiAqL1xuICB0b0J5dGVzKCkge1xuICAgIHJldHVybiBfVXVpZC5iaWdJbnRUb0J5dGVzKHRoaXMuX191dWlkX18pO1xuICB9XG4gIHN0YXRpYyBieXRlc1RvQmlnSW50KGJ5dGVzKSB7XG4gICAgbGV0IHJlc3VsdCA9IDBuO1xuICAgIGZvciAoY29uc3QgYiBvZiBieXRlcykgcmVzdWx0ID0gcmVzdWx0IDw8IDhuIHwgQmlnSW50KGIpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbiAgc3RhdGljIGJpZ0ludFRvQnl0ZXModmFsdWUpIHtcbiAgICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KDE2KTtcbiAgICBmb3IgKGxldCBpID0gMTU7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBieXRlc1tpXSA9IE51bWJlcih2YWx1ZSAmIDB4ZmZuKTtcbiAgICAgIHZhbHVlID4+PSA4bjtcbiAgICB9XG4gICAgcmV0dXJuIGJ5dGVzO1xuICB9XG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSB2ZXJzaW9uIG9mIHRoaXMgVVVJRC5cbiAgICpcbiAgICogVGhpcyByZXByZXNlbnRzIHRoZSBhbGdvcml0aG0gdXNlZCB0byBnZW5lcmF0ZSB0aGUgdmFsdWUuXG4gICAqXG4gICAqIEByZXR1cm5zIEEgYFV1aWRWZXJzaW9uYFxuICAgKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIHZlcnNpb24gZmllbGQgaXMgbm90IHJlY29nbml6ZWRcbiAgICovXG4gIGdldFZlcnNpb24oKSB7XG4gICAgY29uc3QgdmVyc2lvbiA9IHRoaXMudG9CeXRlcygpWzZdID4+IDQgJiAxNTtcbiAgICBzd2l0Y2ggKHZlcnNpb24pIHtcbiAgICAgIGNhc2UgNDpcbiAgICAgICAgcmV0dXJuIFwiVjRcIjtcbiAgICAgIGNhc2UgNzpcbiAgICAgICAgcmV0dXJuIFwiVjdcIjtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmICh0aGlzID09IF9VdWlkLk5JTCkge1xuICAgICAgICAgIHJldHVybiBcIk5pbFwiO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzID09IF9VdWlkLk1BWCkge1xuICAgICAgICAgIHJldHVybiBcIk1heFwiO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgVVVJRCB2ZXJzaW9uOiAke3ZlcnNpb259YCk7XG4gICAgfVxuICB9XG4gIC8qKlxuICAgKiBFeHRyYWN0IHRoZSBtb25vdG9uaWMgY291bnRlciBmcm9tIGEgVVVJRHY3LlxuICAgKlxuICAgKiBJbnRlbmRlZCBmb3IgdGVzdGluZyBhbmQgZGlhZ25vc3RpY3MuXG4gICAqIEJlaGF2aW9yIGlzIHVuZGVmaW5lZCBpZiBjYWxsZWQgb24gYSBub24tVjcgVVVJRC5cbiAgICpcbiAgICogQHJldHVybnMgMzEtYml0IGNvdW50ZXIgdmFsdWVcbiAgICovXG4gIGdldENvdW50ZXIoKSB7XG4gICAgY29uc3QgYnl0ZXMgPSB0aGlzLnRvQnl0ZXMoKTtcbiAgICBjb25zdCBoaWdoID0gYnl0ZXNbN107XG4gICAgY29uc3QgbWlkMSA9IGJ5dGVzWzldO1xuICAgIGNvbnN0IG1pZDIgPSBieXRlc1sxMF07XG4gICAgY29uc3QgbG93ID0gYnl0ZXNbMTFdID4+PiAxO1xuICAgIHJldHVybiBoaWdoIDw8IDIzIHwgbWlkMSA8PCAxNSB8IG1pZDIgPDwgNyB8IGxvdyB8IDA7XG4gIH1cbiAgY29tcGFyZVRvKG90aGVyKSB7XG4gICAgaWYgKHRoaXMuX191dWlkX18gPCBvdGhlci5fX3V1aWRfXykgcmV0dXJuIC0xO1xuICAgIGlmICh0aGlzLl9fdXVpZF9fID4gb3RoZXIuX191dWlkX18pIHJldHVybiAxO1xuICAgIHJldHVybiAwO1xuICB9XG4gIHN0YXRpYyBnZXRBbGdlYnJhaWNUeXBlKCkge1xuICAgIHJldHVybiBBbGdlYnJhaWNUeXBlLlByb2R1Y3Qoe1xuICAgICAgZWxlbWVudHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6IFwiX191dWlkX19cIixcbiAgICAgICAgICBhbGdlYnJhaWNUeXBlOiBBbGdlYnJhaWNUeXBlLlUxMjhcbiAgICAgICAgfVxuICAgICAgXVxuICAgIH0pO1xuICB9XG59O1xuXG4vLyBzcmMvbGliL2Nvbm5lY3Rpb25faWQudHNcbnZhciBDb25uZWN0aW9uSWQgPSBjbGFzcyBfQ29ubmVjdGlvbklkIHtcbiAgX19jb25uZWN0aW9uX2lkX187XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGBDb25uZWN0aW9uSWRgLlxuICAgKi9cbiAgY29uc3RydWN0b3IoZGF0YSkge1xuICAgIHRoaXMuX19jb25uZWN0aW9uX2lkX18gPSBjb2VyY2VUb0JpZ0ludChkYXRhLCBcIkNvbm5lY3Rpb25JZFwiKTtcbiAgfVxuICAvKipcbiAgICogR2V0IHRoZSBhbGdlYnJhaWMgdHlwZSByZXByZXNlbnRhdGlvbiBvZiB0aGUge0BsaW5rIENvbm5lY3Rpb25JZH0gdHlwZS5cbiAgICogQHJldHVybnMgVGhlIGFsZ2VicmFpYyB0eXBlIHJlcHJlc2VudGF0aW9uIG9mIHRoZSB0eXBlLlxuICAgKi9cbiAgc3RhdGljIGdldEFsZ2VicmFpY1R5cGUoKSB7XG4gICAgcmV0dXJuIEFsZ2VicmFpY1R5cGUuUHJvZHVjdCh7XG4gICAgICBlbGVtZW50czogW1xuICAgICAgICB7IG5hbWU6IFwiX19jb25uZWN0aW9uX2lkX19cIiwgYWxnZWJyYWljVHlwZTogQWxnZWJyYWljVHlwZS5VMTI4IH1cbiAgICAgIF1cbiAgICB9KTtcbiAgfVxuICBpc1plcm8oKSB7XG4gICAgcmV0dXJuIHRoaXMuX19jb25uZWN0aW9uX2lkX18gPT09IEJpZ0ludCgwKTtcbiAgfVxuICBzdGF0aWMgbnVsbElmWmVybyhhZGRyKSB7XG4gICAgaWYgKGFkZHIuaXNaZXJvKCkpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gYWRkcjtcbiAgICB9XG4gIH1cbiAgc3RhdGljIHJhbmRvbSgpIHtcbiAgICBmdW5jdGlvbiByYW5kb21VOCgpIHtcbiAgICAgIHJldHVybiBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAyNTUpO1xuICAgIH1cbiAgICBsZXQgcmVzdWx0ID0gQmlnSW50KDApO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTY7IGkrKykge1xuICAgICAgcmVzdWx0ID0gcmVzdWx0IDw8IEJpZ0ludCg4KSB8IEJpZ0ludChyYW5kb21VOCgpKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBfQ29ubmVjdGlvbklkKHJlc3VsdCk7XG4gIH1cbiAgLyoqXG4gICAqIENvbXBhcmUgdHdvIGNvbm5lY3Rpb24gSURzIGZvciBlcXVhbGl0eS5cbiAgICovXG4gIGlzRXF1YWwob3RoZXIpIHtcbiAgICByZXR1cm4gdGhpcy5fX2Nvbm5lY3Rpb25faWRfXyA9PSBvdGhlci5fX2Nvbm5lY3Rpb25faWRfXztcbiAgfVxuICAvKipcbiAgICogQ2hlY2sgaWYgdHdvIGNvbm5lY3Rpb24gSURzIGFyZSBlcXVhbC5cbiAgICovXG4gIGVxdWFscyhvdGhlcikge1xuICAgIHJldHVybiB0aGlzLmlzRXF1YWwob3RoZXIpO1xuICB9XG4gIC8qKlxuICAgKiBQcmludCB0aGUgY29ubmVjdGlvbiBJRCBhcyBhIGhleGFkZWNpbWFsIHN0cmluZy5cbiAgICovXG4gIHRvSGV4U3RyaW5nKCkge1xuICAgIHJldHVybiB1MTI4VG9IZXhTdHJpbmcodGhpcy5fX2Nvbm5lY3Rpb25faWRfXyk7XG4gIH1cbiAgLyoqXG4gICAqIENvbnZlcnQgdGhlIGNvbm5lY3Rpb24gSUQgdG8gYSBVaW50OEFycmF5LlxuICAgKi9cbiAgdG9VaW50OEFycmF5KCkge1xuICAgIHJldHVybiB1MTI4VG9VaW50OEFycmF5KHRoaXMuX19jb25uZWN0aW9uX2lkX18pO1xuICB9XG4gIC8qKlxuICAgKiBQYXJzZSBhIGNvbm5lY3Rpb24gSUQgZnJvbSBhIGhleGFkZWNpbWFsIHN0cmluZy5cbiAgICovXG4gIHN0YXRpYyBmcm9tU3RyaW5nKHN0cikge1xuICAgIHJldHVybiBuZXcgX0Nvbm5lY3Rpb25JZChoZXhTdHJpbmdUb1UxMjgoc3RyKSk7XG4gIH1cbiAgc3RhdGljIGZyb21TdHJpbmdPck51bGwoc3RyKSB7XG4gICAgY29uc3QgYWRkciA9IF9Db25uZWN0aW9uSWQuZnJvbVN0cmluZyhzdHIpO1xuICAgIGlmIChhZGRyLmlzWmVybygpKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGFkZHI7XG4gICAgfVxuICB9XG59O1xuXG4vLyBzcmMvbGliL2lkZW50aXR5LnRzXG52YXIgSWRlbnRpdHkgPSBjbGFzcyBfSWRlbnRpdHkge1xuICBfX2lkZW50aXR5X187XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGBJZGVudGl0eWAuXG4gICAqXG4gICAqIGBkYXRhYCBjYW4gYmUgYSBoZXhhZGVjaW1hbCBzdHJpbmcgb3IgYSBgYmlnaW50YC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGRhdGEpIHtcbiAgICB0aGlzLl9faWRlbnRpdHlfXyA9IHR5cGVvZiBkYXRhID09PSBcInN0cmluZ1wiID8gaGV4U3RyaW5nVG9VMjU2KGRhdGEpIDogY29lcmNlVG9CaWdJbnQoZGF0YSwgXCJJZGVudGl0eVwiKTtcbiAgfVxuICAvKipcbiAgICogR2V0IHRoZSBhbGdlYnJhaWMgdHlwZSByZXByZXNlbnRhdGlvbiBvZiB0aGUge0BsaW5rIElkZW50aXR5fSB0eXBlLlxuICAgKiBAcmV0dXJucyBUaGUgYWxnZWJyYWljIHR5cGUgcmVwcmVzZW50YXRpb24gb2YgdGhlIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgZ2V0QWxnZWJyYWljVHlwZSgpIHtcbiAgICByZXR1cm4gQWxnZWJyYWljVHlwZS5Qcm9kdWN0KHtcbiAgICAgIGVsZW1lbnRzOiBbeyBuYW1lOiBcIl9faWRlbnRpdHlfX1wiLCBhbGdlYnJhaWNUeXBlOiBBbGdlYnJhaWNUeXBlLlUyNTYgfV1cbiAgICB9KTtcbiAgfVxuICAvKipcbiAgICogQ2hlY2sgaWYgdHdvIGlkZW50aXRpZXMgYXJlIGVxdWFsLlxuICAgKi9cbiAgaXNFcXVhbChvdGhlcikge1xuICAgIHJldHVybiB0aGlzLnRvSGV4U3RyaW5nKCkgPT09IG90aGVyLnRvSGV4U3RyaW5nKCk7XG4gIH1cbiAgLyoqXG4gICAqIENoZWNrIGlmIHR3byBpZGVudGl0aWVzIGFyZSBlcXVhbC5cbiAgICovXG4gIGVxdWFscyhvdGhlcikge1xuICAgIHJldHVybiB0aGlzLmlzRXF1YWwob3RoZXIpO1xuICB9XG4gIC8qKlxuICAgKiBQcmludCB0aGUgaWRlbnRpdHkgYXMgYSBoZXhhZGVjaW1hbCBzdHJpbmcuXG4gICAqL1xuICB0b0hleFN0cmluZygpIHtcbiAgICByZXR1cm4gdTI1NlRvSGV4U3RyaW5nKHRoaXMuX19pZGVudGl0eV9fKTtcbiAgfVxuICAvKipcbiAgICogQ29udmVydCB0aGUgYWRkcmVzcyB0byBhIFVpbnQ4QXJyYXkuXG4gICAqL1xuICB0b1VpbnQ4QXJyYXkoKSB7XG4gICAgcmV0dXJuIHUyNTZUb1VpbnQ4QXJyYXkodGhpcy5fX2lkZW50aXR5X18pO1xuICB9XG4gIC8qKlxuICAgKiBQYXJzZSBhbiBJZGVudGl0eSBmcm9tIGEgaGV4YWRlY2ltYWwgc3RyaW5nLlxuICAgKi9cbiAgc3RhdGljIGZyb21TdHJpbmcoc3RyKSB7XG4gICAgcmV0dXJuIG5ldyBfSWRlbnRpdHkoc3RyKTtcbiAgfVxuICAvKipcbiAgICogWmVybyBpZGVudGl0eSAoMHgwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwKVxuICAgKi9cbiAgc3RhdGljIHplcm8oKSB7XG4gICAgcmV0dXJuIG5ldyBfSWRlbnRpdHkoMG4pO1xuICB9XG4gIHRvU3RyaW5nKCkge1xuICAgIHJldHVybiB0aGlzLnRvSGV4U3RyaW5nKCk7XG4gIH1cbn07XG5cbi8vIHNyYy9saWIvYWxnZWJyYWljX3R5cGUudHNcbnZhciBTRVJJQUxJWkVSUyA9IC8qIEBfX1BVUkVfXyAqLyBuZXcgTWFwKCk7XG52YXIgREVTRVJJQUxJWkVSUyA9IC8qIEBfX1BVUkVfXyAqLyBuZXcgTWFwKCk7XG52YXIgQWxnZWJyYWljVHlwZSA9IHtcbiAgUmVmOiAodmFsdWUpID0+ICh7IHRhZzogXCJSZWZcIiwgdmFsdWUgfSksXG4gIFN1bTogKHZhbHVlKSA9PiAoe1xuICAgIHRhZzogXCJTdW1cIixcbiAgICB2YWx1ZVxuICB9KSxcbiAgUHJvZHVjdDogKHZhbHVlKSA9PiAoe1xuICAgIHRhZzogXCJQcm9kdWN0XCIsXG4gICAgdmFsdWVcbiAgfSksXG4gIEFycmF5OiAodmFsdWUpID0+ICh7XG4gICAgdGFnOiBcIkFycmF5XCIsXG4gICAgdmFsdWVcbiAgfSksXG4gIFN0cmluZzogeyB0YWc6IFwiU3RyaW5nXCIgfSxcbiAgQm9vbDogeyB0YWc6IFwiQm9vbFwiIH0sXG4gIEk4OiB7IHRhZzogXCJJOFwiIH0sXG4gIFU4OiB7IHRhZzogXCJVOFwiIH0sXG4gIEkxNjogeyB0YWc6IFwiSTE2XCIgfSxcbiAgVTE2OiB7IHRhZzogXCJVMTZcIiB9LFxuICBJMzI6IHsgdGFnOiBcIkkzMlwiIH0sXG4gIFUzMjogeyB0YWc6IFwiVTMyXCIgfSxcbiAgSTY0OiB7IHRhZzogXCJJNjRcIiB9LFxuICBVNjQ6IHsgdGFnOiBcIlU2NFwiIH0sXG4gIEkxMjg6IHsgdGFnOiBcIkkxMjhcIiB9LFxuICBVMTI4OiB7IHRhZzogXCJVMTI4XCIgfSxcbiAgSTI1NjogeyB0YWc6IFwiSTI1NlwiIH0sXG4gIFUyNTY6IHsgdGFnOiBcIlUyNTZcIiB9LFxuICBGMzI6IHsgdGFnOiBcIkYzMlwiIH0sXG4gIEY2NDogeyB0YWc6IFwiRjY0XCIgfSxcbiAgbWFrZVNlcmlhbGl6ZXIodHksIHR5cGVzcGFjZSkge1xuICAgIGlmICh0eS50YWcgPT09IFwiUmVmXCIpIHtcbiAgICAgIGlmICghdHlwZXNwYWNlKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJjYW5ub3Qgc2VyaWFsaXplIHJlZnMgd2l0aG91dCBhIHR5cGVzcGFjZVwiKTtcbiAgICAgIHdoaWxlICh0eS50YWcgPT09IFwiUmVmXCIpIHR5ID0gdHlwZXNwYWNlLnR5cGVzW3R5LnZhbHVlXTtcbiAgICB9XG4gICAgc3dpdGNoICh0eS50YWcpIHtcbiAgICAgIGNhc2UgXCJQcm9kdWN0XCI6XG4gICAgICAgIHJldHVybiBQcm9kdWN0VHlwZS5tYWtlU2VyaWFsaXplcih0eS52YWx1ZSwgdHlwZXNwYWNlKTtcbiAgICAgIGNhc2UgXCJTdW1cIjpcbiAgICAgICAgcmV0dXJuIFN1bVR5cGUubWFrZVNlcmlhbGl6ZXIodHkudmFsdWUsIHR5cGVzcGFjZSk7XG4gICAgICBjYXNlIFwiQXJyYXlcIjpcbiAgICAgICAgaWYgKHR5LnZhbHVlLnRhZyA9PT0gXCJVOFwiKSB7XG4gICAgICAgICAgcmV0dXJuIHNlcmlhbGl6ZVVpbnQ4QXJyYXk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3Qgc2VyaWFsaXplID0gQWxnZWJyYWljVHlwZS5tYWtlU2VyaWFsaXplcih0eS52YWx1ZSwgdHlwZXNwYWNlKTtcbiAgICAgICAgICByZXR1cm4gKHdyaXRlciwgdmFsdWUpID0+IHtcbiAgICAgICAgICAgIHdyaXRlci53cml0ZVUzMih2YWx1ZS5sZW5ndGgpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBlbGVtIG9mIHZhbHVlKSB7XG4gICAgICAgICAgICAgIHNlcmlhbGl6ZSh3cml0ZXIsIGVsZW0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBwcmltaXRpdmVTZXJpYWxpemVyc1t0eS50YWddO1xuICAgIH1cbiAgfSxcbiAgLyoqIEBkZXByZWNhdGVkIFVzZSBgbWFrZVNlcmlhbGl6ZXJgIGluc3RlYWQuICovXG4gIHNlcmlhbGl6ZVZhbHVlKHdyaXRlciwgdHksIHZhbHVlLCB0eXBlc3BhY2UpIHtcbiAgICBBbGdlYnJhaWNUeXBlLm1ha2VTZXJpYWxpemVyKHR5LCB0eXBlc3BhY2UpKHdyaXRlciwgdmFsdWUpO1xuICB9LFxuICBtYWtlRGVzZXJpYWxpemVyKHR5LCB0eXBlc3BhY2UpIHtcbiAgICBpZiAodHkudGFnID09PSBcIlJlZlwiKSB7XG4gICAgICBpZiAoIXR5cGVzcGFjZSlcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY2Fubm90IGRlc2VyaWFsaXplIHJlZnMgd2l0aG91dCBhIHR5cGVzcGFjZVwiKTtcbiAgICAgIHdoaWxlICh0eS50YWcgPT09IFwiUmVmXCIpIHR5ID0gdHlwZXNwYWNlLnR5cGVzW3R5LnZhbHVlXTtcbiAgICB9XG4gICAgc3dpdGNoICh0eS50YWcpIHtcbiAgICAgIGNhc2UgXCJQcm9kdWN0XCI6XG4gICAgICAgIHJldHVybiBQcm9kdWN0VHlwZS5tYWtlRGVzZXJpYWxpemVyKHR5LnZhbHVlLCB0eXBlc3BhY2UpO1xuICAgICAgY2FzZSBcIlN1bVwiOlxuICAgICAgICByZXR1cm4gU3VtVHlwZS5tYWtlRGVzZXJpYWxpemVyKHR5LnZhbHVlLCB0eXBlc3BhY2UpO1xuICAgICAgY2FzZSBcIkFycmF5XCI6XG4gICAgICAgIGlmICh0eS52YWx1ZS50YWcgPT09IFwiVThcIikge1xuICAgICAgICAgIHJldHVybiBkZXNlcmlhbGl6ZVVpbnQ4QXJyYXk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgZGVzZXJpYWxpemUgPSBBbGdlYnJhaWNUeXBlLm1ha2VEZXNlcmlhbGl6ZXIoXG4gICAgICAgICAgICB0eS52YWx1ZSxcbiAgICAgICAgICAgIHR5cGVzcGFjZVxuICAgICAgICAgICk7XG4gICAgICAgICAgcmV0dXJuIChyZWFkZXIpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGxlbmd0aCA9IHJlYWRlci5yZWFkVTMyKCk7XG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBBcnJheShsZW5ndGgpO1xuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICByZXN1bHRbaV0gPSBkZXNlcmlhbGl6ZShyZWFkZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gcHJpbWl0aXZlRGVzZXJpYWxpemVyc1t0eS50YWddO1xuICAgIH1cbiAgfSxcbiAgLyoqIEBkZXByZWNhdGVkIFVzZSBgbWFrZURlc2VyaWFsaXplcmAgaW5zdGVhZC4gKi9cbiAgZGVzZXJpYWxpemVWYWx1ZShyZWFkZXIsIHR5LCB0eXBlc3BhY2UpIHtcbiAgICByZXR1cm4gQWxnZWJyYWljVHlwZS5tYWtlRGVzZXJpYWxpemVyKHR5LCB0eXBlc3BhY2UpKHJlYWRlcik7XG4gIH0sXG4gIC8qKlxuICAgKiBDb252ZXJ0IGEgdmFsdWUgb2YgdGhlIGFsZ2VicmFpYyB0eXBlIGludG8gc29tZXRoaW5nIHRoYXQgY2FuIGJlIHVzZWQgYXMgYSBrZXkgaW4gYSBtYXAuXG4gICAqIFRoZXJlIGFyZSBubyBndWFyYW50ZWVzIGFib3V0IGJlaW5nIGFibGUgdG8gb3JkZXIgaXQuXG4gICAqIFRoaXMgaXMgb25seSBndWFyYW50ZWVkIHRvIGJlIGNvbXBhcmFibGUgdG8gb3RoZXIgdmFsdWVzIG9mIHRoZSBzYW1lIHR5cGUuXG4gICAqIEBwYXJhbSB2YWx1ZSBBIHZhbHVlIG9mIHRoZSBhbGdlYnJhaWMgdHlwZVxuICAgKiBAcmV0dXJucyBTb21ldGhpbmcgdGhhdCBjYW4gYmUgdXNlZCBhcyBhIGtleSBpbiBhIG1hcC5cbiAgICovXG4gIGludG9NYXBLZXk6IGZ1bmN0aW9uKHR5LCB2YWx1ZSkge1xuICAgIHN3aXRjaCAodHkudGFnKSB7XG4gICAgICBjYXNlIFwiVThcIjpcbiAgICAgIGNhc2UgXCJVMTZcIjpcbiAgICAgIGNhc2UgXCJVMzJcIjpcbiAgICAgIGNhc2UgXCJVNjRcIjpcbiAgICAgIGNhc2UgXCJVMTI4XCI6XG4gICAgICBjYXNlIFwiVTI1NlwiOlxuICAgICAgY2FzZSBcIkk4XCI6XG4gICAgICBjYXNlIFwiSTE2XCI6XG4gICAgICBjYXNlIFwiSTMyXCI6XG4gICAgICBjYXNlIFwiSTY0XCI6XG4gICAgICBjYXNlIFwiSTEyOFwiOlxuICAgICAgY2FzZSBcIkkyNTZcIjpcbiAgICAgIGNhc2UgXCJGMzJcIjpcbiAgICAgIGNhc2UgXCJGNjRcIjpcbiAgICAgIGNhc2UgXCJTdHJpbmdcIjpcbiAgICAgIGNhc2UgXCJCb29sXCI6XG4gICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICAgIGNhc2UgXCJQcm9kdWN0XCI6XG4gICAgICAgIHJldHVybiBQcm9kdWN0VHlwZS5pbnRvTWFwS2V5KHR5LnZhbHVlLCB2YWx1ZSk7XG4gICAgICBkZWZhdWx0OiB7XG4gICAgICAgIGNvbnN0IHdyaXRlciA9IG5ldyBCaW5hcnlXcml0ZXIoMTApO1xuICAgICAgICBBbGdlYnJhaWNUeXBlLnNlcmlhbGl6ZVZhbHVlKHdyaXRlciwgdHksIHZhbHVlKTtcbiAgICAgICAgcmV0dXJuIHdyaXRlci50b0Jhc2U2NCgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcbmZ1bmN0aW9uIGJpbmRDYWxsKGYpIHtcbiAgcmV0dXJuIEZ1bmN0aW9uLnByb3RvdHlwZS5jYWxsLmJpbmQoZik7XG59XG52YXIgcHJpbWl0aXZlU2VyaWFsaXplcnMgPSB7XG4gIEJvb2w6IGJpbmRDYWxsKEJpbmFyeVdyaXRlci5wcm90b3R5cGUud3JpdGVCb29sKSxcbiAgSTg6IGJpbmRDYWxsKEJpbmFyeVdyaXRlci5wcm90b3R5cGUud3JpdGVJOCksXG4gIFU4OiBiaW5kQ2FsbChCaW5hcnlXcml0ZXIucHJvdG90eXBlLndyaXRlVTgpLFxuICBJMTY6IGJpbmRDYWxsKEJpbmFyeVdyaXRlci5wcm90b3R5cGUud3JpdGVJMTYpLFxuICBVMTY6IGJpbmRDYWxsKEJpbmFyeVdyaXRlci5wcm90b3R5cGUud3JpdGVVMTYpLFxuICBJMzI6IGJpbmRDYWxsKEJpbmFyeVdyaXRlci5wcm90b3R5cGUud3JpdGVJMzIpLFxuICBVMzI6IGJpbmRDYWxsKEJpbmFyeVdyaXRlci5wcm90b3R5cGUud3JpdGVVMzIpLFxuICBJNjQ6IGJpbmRDYWxsKEJpbmFyeVdyaXRlci5wcm90b3R5cGUud3JpdGVJNjQpLFxuICBVNjQ6IGJpbmRDYWxsKEJpbmFyeVdyaXRlci5wcm90b3R5cGUud3JpdGVVNjQpLFxuICBJMTI4OiBiaW5kQ2FsbChCaW5hcnlXcml0ZXIucHJvdG90eXBlLndyaXRlSTEyOCksXG4gIFUxMjg6IGJpbmRDYWxsKEJpbmFyeVdyaXRlci5wcm90b3R5cGUud3JpdGVVMTI4KSxcbiAgSTI1NjogYmluZENhbGwoQmluYXJ5V3JpdGVyLnByb3RvdHlwZS53cml0ZUkyNTYpLFxuICBVMjU2OiBiaW5kQ2FsbChCaW5hcnlXcml0ZXIucHJvdG90eXBlLndyaXRlVTI1NiksXG4gIEYzMjogYmluZENhbGwoQmluYXJ5V3JpdGVyLnByb3RvdHlwZS53cml0ZUYzMiksXG4gIEY2NDogYmluZENhbGwoQmluYXJ5V3JpdGVyLnByb3RvdHlwZS53cml0ZUY2NCksXG4gIFN0cmluZzogYmluZENhbGwoQmluYXJ5V3JpdGVyLnByb3RvdHlwZS53cml0ZVN0cmluZylcbn07XG5PYmplY3QuZnJlZXplKHByaW1pdGl2ZVNlcmlhbGl6ZXJzKTtcbnZhciBzZXJpYWxpemVVaW50OEFycmF5ID0gYmluZENhbGwoQmluYXJ5V3JpdGVyLnByb3RvdHlwZS53cml0ZVVJbnQ4QXJyYXkpO1xudmFyIHByaW1pdGl2ZURlc2VyaWFsaXplcnMgPSB7XG4gIEJvb2w6IGJpbmRDYWxsKEJpbmFyeVJlYWRlci5wcm90b3R5cGUucmVhZEJvb2wpLFxuICBJODogYmluZENhbGwoQmluYXJ5UmVhZGVyLnByb3RvdHlwZS5yZWFkSTgpLFxuICBVODogYmluZENhbGwoQmluYXJ5UmVhZGVyLnByb3RvdHlwZS5yZWFkVTgpLFxuICBJMTY6IGJpbmRDYWxsKEJpbmFyeVJlYWRlci5wcm90b3R5cGUucmVhZEkxNiksXG4gIFUxNjogYmluZENhbGwoQmluYXJ5UmVhZGVyLnByb3RvdHlwZS5yZWFkVTE2KSxcbiAgSTMyOiBiaW5kQ2FsbChCaW5hcnlSZWFkZXIucHJvdG90eXBlLnJlYWRJMzIpLFxuICBVMzI6IGJpbmRDYWxsKEJpbmFyeVJlYWRlci5wcm90b3R5cGUucmVhZFUzMiksXG4gIEk2NDogYmluZENhbGwoQmluYXJ5UmVhZGVyLnByb3RvdHlwZS5yZWFkSTY0KSxcbiAgVTY0OiBiaW5kQ2FsbChCaW5hcnlSZWFkZXIucHJvdG90eXBlLnJlYWRVNjQpLFxuICBJMTI4OiBiaW5kQ2FsbChCaW5hcnlSZWFkZXIucHJvdG90eXBlLnJlYWRJMTI4KSxcbiAgVTEyODogYmluZENhbGwoQmluYXJ5UmVhZGVyLnByb3RvdHlwZS5yZWFkVTEyOCksXG4gIEkyNTY6IGJpbmRDYWxsKEJpbmFyeVJlYWRlci5wcm90b3R5cGUucmVhZEkyNTYpLFxuICBVMjU2OiBiaW5kQ2FsbChCaW5hcnlSZWFkZXIucHJvdG90eXBlLnJlYWRVMjU2KSxcbiAgRjMyOiBiaW5kQ2FsbChCaW5hcnlSZWFkZXIucHJvdG90eXBlLnJlYWRGMzIpLFxuICBGNjQ6IGJpbmRDYWxsKEJpbmFyeVJlYWRlci5wcm90b3R5cGUucmVhZEY2NCksXG4gIFN0cmluZzogYmluZENhbGwoQmluYXJ5UmVhZGVyLnByb3RvdHlwZS5yZWFkU3RyaW5nKVxufTtcbk9iamVjdC5mcmVlemUocHJpbWl0aXZlRGVzZXJpYWxpemVycyk7XG52YXIgZGVzZXJpYWxpemVVaW50OEFycmF5ID0gYmluZENhbGwoQmluYXJ5UmVhZGVyLnByb3RvdHlwZS5yZWFkVUludDhBcnJheSk7XG52YXIgcHJpbWl0aXZlU2l6ZXMgPSB7XG4gIEJvb2w6IDEsXG4gIEk4OiAxLFxuICBVODogMSxcbiAgSTE2OiAyLFxuICBVMTY6IDIsXG4gIEkzMjogNCxcbiAgVTMyOiA0LFxuICBJNjQ6IDgsXG4gIFU2NDogOCxcbiAgSTEyODogMTYsXG4gIFUxMjg6IDE2LFxuICBJMjU2OiAzMixcbiAgVTI1NjogMzIsXG4gIEYzMjogNCxcbiAgRjY0OiA4XG59O1xudmFyIGZpeGVkU2l6ZVByaW1pdGl2ZXMgPSBuZXcgU2V0KE9iamVjdC5rZXlzKHByaW1pdGl2ZVNpemVzKSk7XG52YXIgaXNGaXhlZFNpemVQcm9kdWN0ID0gKHR5KSA9PiB0eS5lbGVtZW50cy5ldmVyeShcbiAgKHsgYWxnZWJyYWljVHlwZSB9KSA9PiBmaXhlZFNpemVQcmltaXRpdmVzLmhhcyhhbGdlYnJhaWNUeXBlLnRhZylcbik7XG52YXIgcHJvZHVjdFNpemUgPSAodHkpID0+IHR5LmVsZW1lbnRzLnJlZHVjZShcbiAgKGFjYywgeyBhbGdlYnJhaWNUeXBlIH0pID0+IGFjYyArIHByaW1pdGl2ZVNpemVzW2FsZ2VicmFpY1R5cGUudGFnXSxcbiAgMFxuKTtcbnZhciBwcmltaXRpdmVKU05hbWUgPSB7XG4gIEJvb2w6IFwiVWludDhcIixcbiAgSTg6IFwiSW50OFwiLFxuICBVODogXCJVaW50OFwiLFxuICBJMTY6IFwiSW50MTZcIixcbiAgVTE2OiBcIlVpbnQxNlwiLFxuICBJMzI6IFwiSW50MzJcIixcbiAgVTMyOiBcIlVpbnQzMlwiLFxuICBJNjQ6IFwiQmlnSW50NjRcIixcbiAgVTY0OiBcIkJpZ1VpbnQ2NFwiLFxuICBGMzI6IFwiRmxvYXQzMlwiLFxuICBGNjQ6IFwiRmxvYXQ2NFwiXG59O1xudmFyIHNwZWNpYWxQcm9kdWN0RGVzZXJpYWxpemVycyA9IHtcbiAgX190aW1lX2R1cmF0aW9uX21pY3Jvc19fOiAocmVhZGVyKSA9PiBuZXcgVGltZUR1cmF0aW9uKHJlYWRlci5yZWFkSTY0KCkpLFxuICBfX3RpbWVzdGFtcF9taWNyb3Nfc2luY2VfdW5peF9lcG9jaF9fOiAocmVhZGVyKSA9PiBuZXcgVGltZXN0YW1wKHJlYWRlci5yZWFkSTY0KCkpLFxuICBfX2lkZW50aXR5X186IChyZWFkZXIpID0+IG5ldyBJZGVudGl0eShyZWFkZXIucmVhZFUyNTYoKSksXG4gIF9fY29ubmVjdGlvbl9pZF9fOiAocmVhZGVyKSA9PiBuZXcgQ29ubmVjdGlvbklkKHJlYWRlci5yZWFkVTEyOCgpKSxcbiAgX191dWlkX186IChyZWFkZXIpID0+IG5ldyBVdWlkKHJlYWRlci5yZWFkVTEyOCgpKVxufTtcbk9iamVjdC5mcmVlemUoc3BlY2lhbFByb2R1Y3REZXNlcmlhbGl6ZXJzKTtcbnZhciB1bml0RGVzZXJpYWxpemVyID0gKCkgPT4gKHt9KTtcbnZhciBnZXRFbGVtZW50SW5pdGlhbGl6ZXIgPSAoZWxlbWVudCkgPT4ge1xuICBsZXQgaW5pdDtcbiAgc3dpdGNoIChlbGVtZW50LmFsZ2VicmFpY1R5cGUudGFnKSB7XG4gICAgY2FzZSBcIlN0cmluZ1wiOlxuICAgICAgaW5pdCA9IFwiJydcIjtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgXCJCb29sXCI6XG4gICAgICBpbml0ID0gXCJmYWxzZVwiO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSBcIkk4XCI6XG4gICAgY2FzZSBcIlU4XCI6XG4gICAgY2FzZSBcIkkxNlwiOlxuICAgIGNhc2UgXCJVMTZcIjpcbiAgICBjYXNlIFwiSTMyXCI6XG4gICAgY2FzZSBcIlUzMlwiOlxuICAgICAgaW5pdCA9IFwiMFwiO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSBcIkk2NFwiOlxuICAgIGNhc2UgXCJVNjRcIjpcbiAgICBjYXNlIFwiSTEyOFwiOlxuICAgIGNhc2UgXCJVMTI4XCI6XG4gICAgY2FzZSBcIkkyNTZcIjpcbiAgICBjYXNlIFwiVTI1NlwiOlxuICAgICAgaW5pdCA9IFwiMG5cIjtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgXCJGMzJcIjpcbiAgICBjYXNlIFwiRjY0XCI6XG4gICAgICBpbml0ID0gXCIwLjBcIjtcbiAgICAgIGJyZWFrO1xuICAgIGRlZmF1bHQ6XG4gICAgICBpbml0ID0gXCJ1bmRlZmluZWRcIjtcbiAgfVxuICByZXR1cm4gYCR7ZWxlbWVudC5uYW1lfTogJHtpbml0fWA7XG59O1xudmFyIFByb2R1Y3RUeXBlID0ge1xuICBtYWtlU2VyaWFsaXplcih0eSwgdHlwZXNwYWNlKSB7XG4gICAgbGV0IHNlcmlhbGl6ZXIgPSBTRVJJQUxJWkVSUy5nZXQodHkpO1xuICAgIGlmIChzZXJpYWxpemVyICE9IG51bGwpIHJldHVybiBzZXJpYWxpemVyO1xuICAgIGlmIChpc0ZpeGVkU2l6ZVByb2R1Y3QodHkpKSB7XG4gICAgICBjb25zdCBzaXplID0gcHJvZHVjdFNpemUodHkpO1xuICAgICAgY29uc3QgYm9keTIgPSBgXCJ1c2Ugc3RyaWN0XCI7XG53cml0ZXIuZXhwYW5kQnVmZmVyKCR7c2l6ZX0pO1xuY29uc3QgdmlldyA9IHdyaXRlci52aWV3O1xuJHt0eS5lbGVtZW50cy5tYXAoXG4gICAgICAgICh7IG5hbWUsIGFsZ2VicmFpY1R5cGU6IHsgdGFnIH0gfSkgPT4gdGFnIGluIHByaW1pdGl2ZUpTTmFtZSA/IGB2aWV3LnNldCR7cHJpbWl0aXZlSlNOYW1lW3RhZ119KHdyaXRlci5vZmZzZXQsIHZhbHVlLiR7bmFtZX0sICR7cHJpbWl0aXZlU2l6ZXNbdGFnXSA+IDEgPyBcInRydWVcIiA6IFwiXCJ9KTtcbndyaXRlci5vZmZzZXQgKz0gJHtwcmltaXRpdmVTaXplc1t0YWddfTtgIDogYHdyaXRlci53cml0ZSR7dGFnfSh2YWx1ZS4ke25hbWV9KTtgXG4gICAgICApLmpvaW4oXCJcXG5cIil9YDtcbiAgICAgIHNlcmlhbGl6ZXIgPSBGdW5jdGlvbihcIndyaXRlclwiLCBcInZhbHVlXCIsIGJvZHkyKTtcbiAgICAgIFNFUklBTElaRVJTLnNldCh0eSwgc2VyaWFsaXplcik7XG4gICAgICByZXR1cm4gc2VyaWFsaXplcjtcbiAgICB9XG4gICAgY29uc3Qgc2VyaWFsaXplcnMgPSB7fTtcbiAgICBjb25zdCBib2R5ID0gJ1widXNlIHN0cmljdFwiO1xcbicgKyB0eS5lbGVtZW50cy5tYXAoXG4gICAgICAoZWxlbWVudCkgPT4gYHRoaXMuJHtlbGVtZW50Lm5hbWV9KHdyaXRlciwgdmFsdWUuJHtlbGVtZW50Lm5hbWV9KTtgXG4gICAgKS5qb2luKFwiXFxuXCIpO1xuICAgIHNlcmlhbGl6ZXIgPSBGdW5jdGlvbihcIndyaXRlclwiLCBcInZhbHVlXCIsIGJvZHkpLmJpbmQoXG4gICAgICBzZXJpYWxpemVyc1xuICAgICk7XG4gICAgU0VSSUFMSVpFUlMuc2V0KHR5LCBzZXJpYWxpemVyKTtcbiAgICBmb3IgKGNvbnN0IHsgbmFtZSwgYWxnZWJyYWljVHlwZSB9IG9mIHR5LmVsZW1lbnRzKSB7XG4gICAgICBzZXJpYWxpemVyc1tuYW1lXSA9IEFsZ2VicmFpY1R5cGUubWFrZVNlcmlhbGl6ZXIoXG4gICAgICAgIGFsZ2VicmFpY1R5cGUsXG4gICAgICAgIHR5cGVzcGFjZVxuICAgICAgKTtcbiAgICB9XG4gICAgT2JqZWN0LmZyZWV6ZShzZXJpYWxpemVycyk7XG4gICAgcmV0dXJuIHNlcmlhbGl6ZXI7XG4gIH0sXG4gIC8qKiBAZGVwcmVjYXRlZCBVc2UgYG1ha2VTZXJpYWxpemVyYCBpbnN0ZWFkLiAqL1xuICBzZXJpYWxpemVWYWx1ZSh3cml0ZXIsIHR5LCB2YWx1ZSwgdHlwZXNwYWNlKSB7XG4gICAgUHJvZHVjdFR5cGUubWFrZVNlcmlhbGl6ZXIodHksIHR5cGVzcGFjZSkod3JpdGVyLCB2YWx1ZSk7XG4gIH0sXG4gIG1ha2VEZXNlcmlhbGl6ZXIodHksIHR5cGVzcGFjZSkge1xuICAgIHN3aXRjaCAodHkuZWxlbWVudHMubGVuZ3RoKSB7XG4gICAgICBjYXNlIDA6XG4gICAgICAgIHJldHVybiB1bml0RGVzZXJpYWxpemVyO1xuICAgICAgY2FzZSAxOiB7XG4gICAgICAgIGNvbnN0IGZpZWxkTmFtZSA9IHR5LmVsZW1lbnRzWzBdLm5hbWU7XG4gICAgICAgIGlmIChoYXNPd24oc3BlY2lhbFByb2R1Y3REZXNlcmlhbGl6ZXJzLCBmaWVsZE5hbWUpKVxuICAgICAgICAgIHJldHVybiBzcGVjaWFsUHJvZHVjdERlc2VyaWFsaXplcnNbZmllbGROYW1lXTtcbiAgICAgIH1cbiAgICB9XG4gICAgbGV0IGRlc2VyaWFsaXplciA9IERFU0VSSUFMSVpFUlMuZ2V0KHR5KTtcbiAgICBpZiAoZGVzZXJpYWxpemVyICE9IG51bGwpIHJldHVybiBkZXNlcmlhbGl6ZXI7XG4gICAgaWYgKGlzRml4ZWRTaXplUHJvZHVjdCh0eSkpIHtcbiAgICAgIGNvbnN0IGJvZHkgPSBgXCJ1c2Ugc3RyaWN0XCI7XG5jb25zdCByZXN1bHQgPSB7ICR7dHkuZWxlbWVudHMubWFwKGdldEVsZW1lbnRJbml0aWFsaXplcikuam9pbihcIiwgXCIpfSB9O1xuY29uc3QgdmlldyA9IHJlYWRlci52aWV3O1xuJHt0eS5lbGVtZW50cy5tYXAoXG4gICAgICAgICh7IG5hbWUsIGFsZ2VicmFpY1R5cGU6IHsgdGFnIH0gfSkgPT4gdGFnIGluIHByaW1pdGl2ZUpTTmFtZSA/IHRhZyA9PT0gXCJCb29sXCIgPyBgcmVzdWx0LiR7bmFtZX0gPSB2aWV3LmdldFVpbnQ4KHJlYWRlci5vZmZzZXQpICE9PSAwO1xucmVhZGVyLm9mZnNldCArPSAxO2AgOiBgcmVzdWx0LiR7bmFtZX0gPSB2aWV3LmdldCR7cHJpbWl0aXZlSlNOYW1lW3RhZ119KHJlYWRlci5vZmZzZXQsICR7cHJpbWl0aXZlU2l6ZXNbdGFnXSA+IDEgPyBcInRydWVcIiA6IFwiXCJ9KTtcbnJlYWRlci5vZmZzZXQgKz0gJHtwcmltaXRpdmVTaXplc1t0YWddfTtgIDogYHJlc3VsdC4ke25hbWV9ID0gcmVhZGVyLnJlYWQke3RhZ30oKTtgXG4gICAgICApLmpvaW4oXCJcXG5cIil9XG5yZXR1cm4gcmVzdWx0O2A7XG4gICAgICBkZXNlcmlhbGl6ZXIgPSBGdW5jdGlvbihcInJlYWRlclwiLCBib2R5KTtcbiAgICAgIERFU0VSSUFMSVpFUlMuc2V0KHR5LCBkZXNlcmlhbGl6ZXIpO1xuICAgICAgcmV0dXJuIGRlc2VyaWFsaXplcjtcbiAgICB9XG4gICAgY29uc3QgZGVzZXJpYWxpemVycyA9IHt9O1xuICAgIGRlc2VyaWFsaXplciA9IEZ1bmN0aW9uKFxuICAgICAgXCJyZWFkZXJcIixcbiAgICAgIGBcInVzZSBzdHJpY3RcIjtcbmNvbnN0IHJlc3VsdCA9IHsgJHt0eS5lbGVtZW50cy5tYXAoZ2V0RWxlbWVudEluaXRpYWxpemVyKS5qb2luKFwiLCBcIil9IH07XG4ke3R5LmVsZW1lbnRzLm1hcCgoeyBuYW1lIH0pID0+IGByZXN1bHQuJHtuYW1lfSA9IHRoaXMuJHtuYW1lfShyZWFkZXIpO2ApLmpvaW4oXCJcXG5cIil9XG5yZXR1cm4gcmVzdWx0O2BcbiAgICApLmJpbmQoZGVzZXJpYWxpemVycyk7XG4gICAgREVTRVJJQUxJWkVSUy5zZXQodHksIGRlc2VyaWFsaXplcik7XG4gICAgZm9yIChjb25zdCB7IG5hbWUsIGFsZ2VicmFpY1R5cGUgfSBvZiB0eS5lbGVtZW50cykge1xuICAgICAgZGVzZXJpYWxpemVyc1tuYW1lXSA9IEFsZ2VicmFpY1R5cGUubWFrZURlc2VyaWFsaXplcihcbiAgICAgICAgYWxnZWJyYWljVHlwZSxcbiAgICAgICAgdHlwZXNwYWNlXG4gICAgICApO1xuICAgIH1cbiAgICBPYmplY3QuZnJlZXplKGRlc2VyaWFsaXplcnMpO1xuICAgIHJldHVybiBkZXNlcmlhbGl6ZXI7XG4gIH0sXG4gIC8qKiBAZGVwcmVjYXRlZCBVc2UgYG1ha2VEZXNlcmlhbGl6ZXJgIGluc3RlYWQuICovXG4gIGRlc2VyaWFsaXplVmFsdWUocmVhZGVyLCB0eSwgdHlwZXNwYWNlKSB7XG4gICAgcmV0dXJuIFByb2R1Y3RUeXBlLm1ha2VEZXNlcmlhbGl6ZXIodHksIHR5cGVzcGFjZSkocmVhZGVyKTtcbiAgfSxcbiAgaW50b01hcEtleSh0eSwgdmFsdWUpIHtcbiAgICBpZiAodHkuZWxlbWVudHMubGVuZ3RoID09PSAxKSB7XG4gICAgICBjb25zdCBmaWVsZE5hbWUgPSB0eS5lbGVtZW50c1swXS5uYW1lO1xuICAgICAgaWYgKGhhc093bihzcGVjaWFsUHJvZHVjdERlc2VyaWFsaXplcnMsIGZpZWxkTmFtZSkpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlW2ZpZWxkTmFtZV07XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHdyaXRlciA9IG5ldyBCaW5hcnlXcml0ZXIoMTApO1xuICAgIEFsZ2VicmFpY1R5cGUuc2VyaWFsaXplVmFsdWUod3JpdGVyLCBBbGdlYnJhaWNUeXBlLlByb2R1Y3QodHkpLCB2YWx1ZSk7XG4gICAgcmV0dXJuIHdyaXRlci50b0Jhc2U2NCgpO1xuICB9XG59O1xudmFyIFN1bVR5cGUgPSB7XG4gIG1ha2VTZXJpYWxpemVyKHR5LCB0eXBlc3BhY2UpIHtcbiAgICBpZiAodHkudmFyaWFudHMubGVuZ3RoID09IDIgJiYgdHkudmFyaWFudHNbMF0ubmFtZSA9PT0gXCJzb21lXCIgJiYgdHkudmFyaWFudHNbMV0ubmFtZSA9PT0gXCJub25lXCIpIHtcbiAgICAgIGNvbnN0IHNlcmlhbGl6ZSA9IEFsZ2VicmFpY1R5cGUubWFrZVNlcmlhbGl6ZXIoXG4gICAgICAgIHR5LnZhcmlhbnRzWzBdLmFsZ2VicmFpY1R5cGUsXG4gICAgICAgIHR5cGVzcGFjZVxuICAgICAgKTtcbiAgICAgIHJldHVybiAod3JpdGVyLCB2YWx1ZSkgPT4ge1xuICAgICAgICBpZiAodmFsdWUgIT09IG51bGwgJiYgdmFsdWUgIT09IHZvaWQgMCkge1xuICAgICAgICAgIHdyaXRlci53cml0ZUJ5dGUoMCk7XG4gICAgICAgICAgc2VyaWFsaXplKHdyaXRlciwgdmFsdWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHdyaXRlci53cml0ZUJ5dGUoMSk7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgfSBlbHNlIGlmICh0eS52YXJpYW50cy5sZW5ndGggPT0gMiAmJiB0eS52YXJpYW50c1swXS5uYW1lID09PSBcIm9rXCIgJiYgdHkudmFyaWFudHNbMV0ubmFtZSA9PT0gXCJlcnJcIikge1xuICAgICAgY29uc3Qgc2VyaWFsaXplT2sgPSBBbGdlYnJhaWNUeXBlLm1ha2VTZXJpYWxpemVyKFxuICAgICAgICB0eS52YXJpYW50c1swXS5hbGdlYnJhaWNUeXBlLFxuICAgICAgICB0eXBlc3BhY2VcbiAgICAgICk7XG4gICAgICBjb25zdCBzZXJpYWxpemVFcnIgPSBBbGdlYnJhaWNUeXBlLm1ha2VTZXJpYWxpemVyKFxuICAgICAgICB0eS52YXJpYW50c1swXS5hbGdlYnJhaWNUeXBlLFxuICAgICAgICB0eXBlc3BhY2VcbiAgICAgICk7XG4gICAgICByZXR1cm4gKHdyaXRlciwgdmFsdWUpID0+IHtcbiAgICAgICAgaWYgKFwib2tcIiBpbiB2YWx1ZSkge1xuICAgICAgICAgIHdyaXRlci53cml0ZVU4KDApO1xuICAgICAgICAgIHNlcmlhbGl6ZU9rKHdyaXRlciwgdmFsdWUub2spO1xuICAgICAgICB9IGVsc2UgaWYgKFwiZXJyXCIgaW4gdmFsdWUpIHtcbiAgICAgICAgICB3cml0ZXIud3JpdGVVOCgxKTtcbiAgICAgICAgICBzZXJpYWxpemVFcnIod3JpdGVyLCB2YWx1ZS5lcnIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgICBcImNvdWxkIG5vdCBzZXJpYWxpemUgcmVzdWx0OiBvYmplY3QgaGFkIG5laXRoZXIgYSBgb2tgIG5vciBhbiBgZXJyYCBmaWVsZFwiXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGV0IHNlcmlhbGl6ZXIgPSBTRVJJQUxJWkVSUy5nZXQodHkpO1xuICAgICAgaWYgKHNlcmlhbGl6ZXIgIT0gbnVsbCkgcmV0dXJuIHNlcmlhbGl6ZXI7XG4gICAgICBjb25zdCBzZXJpYWxpemVycyA9IHt9O1xuICAgICAgY29uc3QgYm9keSA9IGBzd2l0Y2ggKHZhbHVlLnRhZykge1xuJHt0eS52YXJpYW50cy5tYXAoXG4gICAgICAgICh7IG5hbWUgfSwgaSkgPT4gYCAgY2FzZSAke0pTT04uc3RyaW5naWZ5KG5hbWUpfTpcbiAgICB3cml0ZXIud3JpdGVCeXRlKCR7aX0pO1xuICAgIHJldHVybiB0aGlzLiR7bmFtZX0od3JpdGVyLCB2YWx1ZS52YWx1ZSk7YFxuICAgICAgKS5qb2luKFwiXFxuXCIpfVxuICBkZWZhdWx0OlxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICBcXGBDb3VsZCBub3Qgc2VyaWFsaXplIHN1bSB0eXBlOyB1bmtub3duIHRhZyBcXCR7dmFsdWUudGFnfVxcYFxuICAgIClcbn1cbmA7XG4gICAgICBzZXJpYWxpemVyID0gRnVuY3Rpb24oXCJ3cml0ZXJcIiwgXCJ2YWx1ZVwiLCBib2R5KS5iaW5kKFxuICAgICAgICBzZXJpYWxpemVyc1xuICAgICAgKTtcbiAgICAgIFNFUklBTElaRVJTLnNldCh0eSwgc2VyaWFsaXplcik7XG4gICAgICBmb3IgKGNvbnN0IHsgbmFtZSwgYWxnZWJyYWljVHlwZSB9IG9mIHR5LnZhcmlhbnRzKSB7XG4gICAgICAgIHNlcmlhbGl6ZXJzW25hbWVdID0gQWxnZWJyYWljVHlwZS5tYWtlU2VyaWFsaXplcihcbiAgICAgICAgICBhbGdlYnJhaWNUeXBlLFxuICAgICAgICAgIHR5cGVzcGFjZVxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgT2JqZWN0LmZyZWV6ZShzZXJpYWxpemVycyk7XG4gICAgICByZXR1cm4gc2VyaWFsaXplcjtcbiAgICB9XG4gIH0sXG4gIC8qKiBAZGVwcmVjYXRlZCBVc2UgYG1ha2VTZXJpYWxpemVyYCBpbnN0ZWFkLiAqL1xuICBzZXJpYWxpemVWYWx1ZSh3cml0ZXIsIHR5LCB2YWx1ZSwgdHlwZXNwYWNlKSB7XG4gICAgU3VtVHlwZS5tYWtlU2VyaWFsaXplcih0eSwgdHlwZXNwYWNlKSh3cml0ZXIsIHZhbHVlKTtcbiAgfSxcbiAgbWFrZURlc2VyaWFsaXplcih0eSwgdHlwZXNwYWNlKSB7XG4gICAgaWYgKHR5LnZhcmlhbnRzLmxlbmd0aCA9PSAyICYmIHR5LnZhcmlhbnRzWzBdLm5hbWUgPT09IFwic29tZVwiICYmIHR5LnZhcmlhbnRzWzFdLm5hbWUgPT09IFwibm9uZVwiKSB7XG4gICAgICBjb25zdCBkZXNlcmlhbGl6ZSA9IEFsZ2VicmFpY1R5cGUubWFrZURlc2VyaWFsaXplcihcbiAgICAgICAgdHkudmFyaWFudHNbMF0uYWxnZWJyYWljVHlwZSxcbiAgICAgICAgdHlwZXNwYWNlXG4gICAgICApO1xuICAgICAgcmV0dXJuIChyZWFkZXIpID0+IHtcbiAgICAgICAgY29uc3QgdGFnID0gcmVhZGVyLnJlYWRVOCgpO1xuICAgICAgICBpZiAodGFnID09PSAwKSB7XG4gICAgICAgICAgcmV0dXJuIGRlc2VyaWFsaXplKHJlYWRlcik7XG4gICAgICAgIH0gZWxzZSBpZiAodGFnID09PSAxKSB7XG4gICAgICAgICAgcmV0dXJuIHZvaWQgMDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBgQ2FuJ3QgZGVzZXJpYWxpemUgYW4gb3B0aW9uIHR5cGUsIGNvdWxkbid0IGZpbmQgJHt0YWd9IHRhZ2A7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgfSBlbHNlIGlmICh0eS52YXJpYW50cy5sZW5ndGggPT0gMiAmJiB0eS52YXJpYW50c1swXS5uYW1lID09PSBcIm9rXCIgJiYgdHkudmFyaWFudHNbMV0ubmFtZSA9PT0gXCJlcnJcIikge1xuICAgICAgY29uc3QgZGVzZXJpYWxpemVPayA9IEFsZ2VicmFpY1R5cGUubWFrZURlc2VyaWFsaXplcihcbiAgICAgICAgdHkudmFyaWFudHNbMF0uYWxnZWJyYWljVHlwZSxcbiAgICAgICAgdHlwZXNwYWNlXG4gICAgICApO1xuICAgICAgY29uc3QgZGVzZXJpYWxpemVFcnIgPSBBbGdlYnJhaWNUeXBlLm1ha2VEZXNlcmlhbGl6ZXIoXG4gICAgICAgIHR5LnZhcmlhbnRzWzFdLmFsZ2VicmFpY1R5cGUsXG4gICAgICAgIHR5cGVzcGFjZVxuICAgICAgKTtcbiAgICAgIHJldHVybiAocmVhZGVyKSA9PiB7XG4gICAgICAgIGNvbnN0IHRhZyA9IHJlYWRlci5yZWFkQnl0ZSgpO1xuICAgICAgICBpZiAodGFnID09PSAwKSB7XG4gICAgICAgICAgcmV0dXJuIHsgb2s6IGRlc2VyaWFsaXplT2socmVhZGVyKSB9O1xuICAgICAgICB9IGVsc2UgaWYgKHRhZyA9PT0gMSkge1xuICAgICAgICAgIHJldHVybiB7IGVycjogZGVzZXJpYWxpemVFcnIocmVhZGVyKSB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGBDYW4ndCBkZXNlcmlhbGl6ZSBhIHJlc3VsdCB0eXBlLCBjb3VsZG4ndCBmaW5kICR7dGFnfSB0YWdgO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgIH0gZWxzZSB7XG4gICAgICBsZXQgZGVzZXJpYWxpemVyID0gREVTRVJJQUxJWkVSUy5nZXQodHkpO1xuICAgICAgaWYgKGRlc2VyaWFsaXplciAhPSBudWxsKSByZXR1cm4gZGVzZXJpYWxpemVyO1xuICAgICAgY29uc3QgZGVzZXJpYWxpemVycyA9IHt9O1xuICAgICAgZGVzZXJpYWxpemVyID0gRnVuY3Rpb24oXG4gICAgICAgIFwicmVhZGVyXCIsXG4gICAgICAgIGBzd2l0Y2ggKHJlYWRlci5yZWFkVTgoKSkge1xuJHt0eS52YXJpYW50cy5tYXAoXG4gICAgICAgICAgKHsgbmFtZSB9LCBpKSA9PiBgY2FzZSAke2l9OiByZXR1cm4geyB0YWc6ICR7SlNPTi5zdHJpbmdpZnkobmFtZSl9LCB2YWx1ZTogdGhpcy4ke25hbWV9KHJlYWRlcikgfTtgXG4gICAgICAgICkuam9pbihcIlxcblwiKX0gfWBcbiAgICAgICkuYmluZChkZXNlcmlhbGl6ZXJzKTtcbiAgICAgIERFU0VSSUFMSVpFUlMuc2V0KHR5LCBkZXNlcmlhbGl6ZXIpO1xuICAgICAgZm9yIChjb25zdCB7IG5hbWUsIGFsZ2VicmFpY1R5cGUgfSBvZiB0eS52YXJpYW50cykge1xuICAgICAgICBkZXNlcmlhbGl6ZXJzW25hbWVdID0gQWxnZWJyYWljVHlwZS5tYWtlRGVzZXJpYWxpemVyKFxuICAgICAgICAgIGFsZ2VicmFpY1R5cGUsXG4gICAgICAgICAgdHlwZXNwYWNlXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBPYmplY3QuZnJlZXplKGRlc2VyaWFsaXplcnMpO1xuICAgICAgcmV0dXJuIGRlc2VyaWFsaXplcjtcbiAgICB9XG4gIH0sXG4gIC8qKiBAZGVwcmVjYXRlZCBVc2UgYG1ha2VEZXNlcmlhbGl6ZXJgIGluc3RlYWQuICovXG4gIGRlc2VyaWFsaXplVmFsdWUocmVhZGVyLCB0eSwgdHlwZXNwYWNlKSB7XG4gICAgcmV0dXJuIFN1bVR5cGUubWFrZURlc2VyaWFsaXplcih0eSwgdHlwZXNwYWNlKShyZWFkZXIpO1xuICB9XG59O1xuXG4vLyBzcmMvbGliL29wdGlvbi50c1xudmFyIE9wdGlvbiA9IHtcbiAgZ2V0QWxnZWJyYWljVHlwZShpbm5lclR5cGUpIHtcbiAgICByZXR1cm4gQWxnZWJyYWljVHlwZS5TdW0oe1xuICAgICAgdmFyaWFudHM6IFtcbiAgICAgICAgeyBuYW1lOiBcInNvbWVcIiwgYWxnZWJyYWljVHlwZTogaW5uZXJUeXBlIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiBcIm5vbmVcIixcbiAgICAgICAgICBhbGdlYnJhaWNUeXBlOiBBbGdlYnJhaWNUeXBlLlByb2R1Y3QoeyBlbGVtZW50czogW10gfSlcbiAgICAgICAgfVxuICAgICAgXVxuICAgIH0pO1xuICB9XG59O1xuXG4vLyBzcmMvbGliL3Jlc3VsdC50c1xudmFyIFJlc3VsdCA9IHtcbiAgZ2V0QWxnZWJyYWljVHlwZShva1R5cGUsIGVyclR5cGUpIHtcbiAgICByZXR1cm4gQWxnZWJyYWljVHlwZS5TdW0oe1xuICAgICAgdmFyaWFudHM6IFtcbiAgICAgICAgeyBuYW1lOiBcIm9rXCIsIGFsZ2VicmFpY1R5cGU6IG9rVHlwZSB9LFxuICAgICAgICB7IG5hbWU6IFwiZXJyXCIsIGFsZ2VicmFpY1R5cGU6IGVyclR5cGUgfVxuICAgICAgXVxuICAgIH0pO1xuICB9XG59O1xuXG4vLyBzcmMvbGliL3NjaGVkdWxlX2F0LnRzXG52YXIgU2NoZWR1bGVBdCA9IHtcbiAgaW50ZXJ2YWwodmFsdWUpIHtcbiAgICByZXR1cm4gSW50ZXJ2YWwodmFsdWUpO1xuICB9LFxuICB0aW1lKHZhbHVlKSB7XG4gICAgcmV0dXJuIFRpbWUodmFsdWUpO1xuICB9LFxuICBnZXRBbGdlYnJhaWNUeXBlKCkge1xuICAgIHJldHVybiBBbGdlYnJhaWNUeXBlLlN1bSh7XG4gICAgICB2YXJpYW50czogW1xuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogXCJJbnRlcnZhbFwiLFxuICAgICAgICAgIGFsZ2VicmFpY1R5cGU6IFRpbWVEdXJhdGlvbi5nZXRBbGdlYnJhaWNUeXBlKClcbiAgICAgICAgfSxcbiAgICAgICAgeyBuYW1lOiBcIlRpbWVcIiwgYWxnZWJyYWljVHlwZTogVGltZXN0YW1wLmdldEFsZ2VicmFpY1R5cGUoKSB9XG4gICAgICBdXG4gICAgfSk7XG4gIH0sXG4gIGlzU2NoZWR1bGVBdChhbGdlYnJhaWNUeXBlKSB7XG4gICAgaWYgKGFsZ2VicmFpY1R5cGUudGFnICE9PSBcIlN1bVwiKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnN0IHZhcmlhbnRzID0gYWxnZWJyYWljVHlwZS52YWx1ZS52YXJpYW50cztcbiAgICBpZiAodmFyaWFudHMubGVuZ3RoICE9PSAyKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnN0IGludGVydmFsVmFyaWFudCA9IHZhcmlhbnRzLmZpbmQoKHYpID0+IHYubmFtZSA9PT0gXCJJbnRlcnZhbFwiKTtcbiAgICBjb25zdCB0aW1lVmFyaWFudCA9IHZhcmlhbnRzLmZpbmQoKHYpID0+IHYubmFtZSA9PT0gXCJUaW1lXCIpO1xuICAgIGlmICghaW50ZXJ2YWxWYXJpYW50IHx8ICF0aW1lVmFyaWFudCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gVGltZUR1cmF0aW9uLmlzVGltZUR1cmF0aW9uKGludGVydmFsVmFyaWFudC5hbGdlYnJhaWNUeXBlKSAmJiBUaW1lc3RhbXAuaXNUaW1lc3RhbXAodGltZVZhcmlhbnQuYWxnZWJyYWljVHlwZSk7XG4gIH1cbn07XG52YXIgSW50ZXJ2YWwgPSAobWljcm9zKSA9PiAoe1xuICB0YWc6IFwiSW50ZXJ2YWxcIixcbiAgdmFsdWU6IG5ldyBUaW1lRHVyYXRpb24obWljcm9zKVxufSk7XG52YXIgVGltZSA9IChtaWNyb3NTaW5jZVVuaXhFcG9jaCkgPT4gKHtcbiAgdGFnOiBcIlRpbWVcIixcbiAgdmFsdWU6IG5ldyBUaW1lc3RhbXAobWljcm9zU2luY2VVbml4RXBvY2gpXG59KTtcbnZhciBzY2hlZHVsZV9hdF9kZWZhdWx0ID0gU2NoZWR1bGVBdDtcblxuLy8gc3JjL2xpYi90eXBlX3V0aWwudHNcbmZ1bmN0aW9uIHNldCh4LCB0Mikge1xuICByZXR1cm4geyAuLi54LCAuLi50MiB9O1xufVxuXG4vLyBzcmMvbGliL3R5cGVfYnVpbGRlcnMudHNcbnZhciBUeXBlQnVpbGRlciA9IGNsYXNzIHtcbiAgLyoqXG4gICAqIFRoZSBUeXBlU2NyaXB0IHBoYW50b20gdHlwZS4gVGhpcyBpcyBub3Qgc3RvcmVkIGF0IHJ1bnRpbWUsXG4gICAqIGJ1dCBpcyB2aXNpYmxlIHRvIHRoZSBjb21waWxlclxuICAgKi9cbiAgdHlwZTtcbiAgLyoqXG4gICAqIFRoZSBTcGFjZXRpbWVEQiBhbGdlYnJhaWMgdHlwZSAocnVu4oCRdGltZSB2YWx1ZSkuIEluIGFkZGl0aW9uIHRvIHN0b3JpbmdcbiAgICogdGhlIHJ1bnRpbWUgcmVwcmVzZW50YXRpb24gb2YgdGhlIGBBbGdlYnJhaWNUeXBlYCwgaXQgYWxzbyBjYXB0dXJlc1xuICAgKiB0aGUgVHlwZVNjcmlwdCB0eXBlIGluZm9ybWF0aW9uIG9mIHRoZSBgQWxnZWJyYWljVHlwZWAuIFRoYXQgaXMgdG8gc2F5XG4gICAqIHRoZSB2YWx1ZSBpcyBub3QgbWVyZWx5IGFuIGBBbGdlYnJhaWNUeXBlYCwgYnV0IGlzIGNvbnN0cnVjdGVkIHRvIGJlXG4gICAqIHRoZSBjb3JyZXNwb25kaW5nIGNvbmNyZXRlIGBBbGdlYnJhaWNUeXBlYCBmb3IgdGhlIFR5cGVTY3JpcHQgdHlwZSBgVHlwZWAuXG4gICAqXG4gICAqIGUuZy4gYHN0cmluZ2AgY29ycmVzcG9uZHMgdG8gYEFsZ2VicmFpY1R5cGUuU3RyaW5nYFxuICAgKi9cbiAgYWxnZWJyYWljVHlwZTtcbiAgY29uc3RydWN0b3IoYWxnZWJyYWljVHlwZSkge1xuICAgIHRoaXMuYWxnZWJyYWljVHlwZSA9IGFsZ2VicmFpY1R5cGU7XG4gIH1cbiAgb3B0aW9uYWwoKSB7XG4gICAgcmV0dXJuIG5ldyBPcHRpb25CdWlsZGVyKHRoaXMpO1xuICB9XG4gIHNlcmlhbGl6ZSh3cml0ZXIsIHZhbHVlKSB7XG4gICAgY29uc3Qgc2VyaWFsaXplID0gdGhpcy5zZXJpYWxpemUgPSBBbGdlYnJhaWNUeXBlLm1ha2VTZXJpYWxpemVyKFxuICAgICAgdGhpcy5hbGdlYnJhaWNUeXBlXG4gICAgKTtcbiAgICBzZXJpYWxpemUod3JpdGVyLCB2YWx1ZSk7XG4gIH1cbiAgZGVzZXJpYWxpemUocmVhZGVyKSB7XG4gICAgY29uc3QgZGVzZXJpYWxpemUgPSB0aGlzLmRlc2VyaWFsaXplID0gQWxnZWJyYWljVHlwZS5tYWtlRGVzZXJpYWxpemVyKFxuICAgICAgdGhpcy5hbGdlYnJhaWNUeXBlXG4gICAgKTtcbiAgICByZXR1cm4gZGVzZXJpYWxpemUocmVhZGVyKTtcbiAgfVxufTtcbnZhciBVOEJ1aWxkZXIgPSBjbGFzcyBleHRlbmRzIFR5cGVCdWlsZGVyIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoQWxnZWJyYWljVHlwZS5VOCk7XG4gIH1cbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBVOENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgVThDb2x1bW5CdWlsZGVyKHRoaXMsIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaXNVbmlxdWU6IHRydWUgfSkpO1xuICB9XG4gIHByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIG5ldyBVOENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGF1dG9JbmMoKSB7XG4gICAgcmV0dXJuIG5ldyBVOENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc0F1dG9JbmNyZW1lbnQ6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IFU4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGRlZmF1bHRWYWx1ZTogdmFsdWUgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgVThDb2x1bW5CdWlsZGVyKHRoaXMsIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgbmFtZSB9KSk7XG4gIH1cbn07XG52YXIgVTE2QnVpbGRlciA9IGNsYXNzIGV4dGVuZHMgVHlwZUJ1aWxkZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihBbGdlYnJhaWNUeXBlLlUxNik7XG4gIH1cbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBVMTZDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaW5kZXhUeXBlOiBhbGdvcml0aG0gfSlcbiAgICApO1xuICB9XG4gIHVuaXF1ZSgpIHtcbiAgICByZXR1cm4gbmV3IFUxNkNvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KSk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IFUxNkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGF1dG9JbmMoKSB7XG4gICAgcmV0dXJuIG5ldyBVMTZDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaXNBdXRvSW5jcmVtZW50OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBVMTZDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBVMTZDb2x1bW5CdWlsZGVyKHRoaXMsIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgbmFtZSB9KSk7XG4gIH1cbn07XG52YXIgVTMyQnVpbGRlciA9IGNsYXNzIGV4dGVuZHMgVHlwZUJ1aWxkZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihBbGdlYnJhaWNUeXBlLlUzMik7XG4gIH1cbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBVMzJDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaW5kZXhUeXBlOiBhbGdvcml0aG0gfSlcbiAgICApO1xuICB9XG4gIHVuaXF1ZSgpIHtcbiAgICByZXR1cm4gbmV3IFUzMkNvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KSk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IFUzMkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGF1dG9JbmMoKSB7XG4gICAgcmV0dXJuIG5ldyBVMzJDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaXNBdXRvSW5jcmVtZW50OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBVMzJDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBVMzJDb2x1bW5CdWlsZGVyKHRoaXMsIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgbmFtZSB9KSk7XG4gIH1cbn07XG52YXIgVTY0QnVpbGRlciA9IGNsYXNzIGV4dGVuZHMgVHlwZUJ1aWxkZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihBbGdlYnJhaWNUeXBlLlU2NCk7XG4gIH1cbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBVNjRDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaW5kZXhUeXBlOiBhbGdvcml0aG0gfSlcbiAgICApO1xuICB9XG4gIHVuaXF1ZSgpIHtcbiAgICByZXR1cm4gbmV3IFU2NENvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KSk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IFU2NENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGF1dG9JbmMoKSB7XG4gICAgcmV0dXJuIG5ldyBVNjRDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaXNBdXRvSW5jcmVtZW50OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBVNjRDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBVNjRDb2x1bW5CdWlsZGVyKHRoaXMsIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgbmFtZSB9KSk7XG4gIH1cbn07XG52YXIgVTEyOEJ1aWxkZXIgPSBjbGFzcyBleHRlbmRzIFR5cGVCdWlsZGVyIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoQWxnZWJyYWljVHlwZS5VMTI4KTtcbiAgfVxuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IFUxMjhDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaW5kZXhUeXBlOiBhbGdvcml0aG0gfSlcbiAgICApO1xuICB9XG4gIHVuaXF1ZSgpIHtcbiAgICByZXR1cm4gbmV3IFUxMjhDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaXNVbmlxdWU6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIHByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIG5ldyBVMTI4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgYXV0b0luYygpIHtcbiAgICByZXR1cm4gbmV3IFUxMjhDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaXNBdXRvSW5jcmVtZW50OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBVMTI4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGRlZmF1bHRWYWx1ZTogdmFsdWUgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgVTEyOENvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBuYW1lIH0pKTtcbiAgfVxufTtcbnZhciBVMjU2QnVpbGRlciA9IGNsYXNzIGV4dGVuZHMgVHlwZUJ1aWxkZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihBbGdlYnJhaWNUeXBlLlUyNTYpO1xuICB9XG4gIGluZGV4KGFsZ29yaXRobSA9IFwiYnRyZWVcIikge1xuICAgIHJldHVybiBuZXcgVTI1NkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgVTI1NkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IFUyNTZDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaXNQcmltYXJ5S2V5OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBhdXRvSW5jKCkge1xuICAgIHJldHVybiBuZXcgVTI1NkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc0F1dG9JbmNyZW1lbnQ6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IFUyNTZDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBVMjU2Q29sdW1uQnVpbGRlcih0aGlzLCBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IG5hbWUgfSkpO1xuICB9XG59O1xudmFyIEk4QnVpbGRlciA9IGNsYXNzIGV4dGVuZHMgVHlwZUJ1aWxkZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihBbGdlYnJhaWNUeXBlLkk4KTtcbiAgfVxuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IEk4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICB1bmlxdWUoKSB7XG4gICAgcmV0dXJuIG5ldyBJOENvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KSk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IEk4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgYXV0b0luYygpIHtcbiAgICByZXR1cm4gbmV3IEk4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzQXV0b0luY3JlbWVudDogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgSThDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBJOENvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBuYW1lIH0pKTtcbiAgfVxufTtcbnZhciBJMTZCdWlsZGVyID0gY2xhc3MgZXh0ZW5kcyBUeXBlQnVpbGRlciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKEFsZ2VicmFpY1R5cGUuSTE2KTtcbiAgfVxuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IEkxNkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgSTE2Q29sdW1uQnVpbGRlcih0aGlzLCBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgSTE2Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgYXV0b0luYygpIHtcbiAgICByZXR1cm4gbmV3IEkxNkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc0F1dG9JbmNyZW1lbnQ6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IEkxNkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBkZWZhdWx0VmFsdWU6IHZhbHVlIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IEkxNkNvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBuYW1lIH0pKTtcbiAgfVxufTtcbnZhciBJMzJCdWlsZGVyID0gY2xhc3MgZXh0ZW5kcyBUeXBlQnVpbGRlciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKEFsZ2VicmFpY1R5cGUuSTMyKTtcbiAgfVxuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IEkzMkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgSTMyQ29sdW1uQnVpbGRlcih0aGlzLCBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgSTMyQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgYXV0b0luYygpIHtcbiAgICByZXR1cm4gbmV3IEkzMkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc0F1dG9JbmNyZW1lbnQ6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IEkzMkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBkZWZhdWx0VmFsdWU6IHZhbHVlIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IEkzMkNvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBuYW1lIH0pKTtcbiAgfVxufTtcbnZhciBJNjRCdWlsZGVyID0gY2xhc3MgZXh0ZW5kcyBUeXBlQnVpbGRlciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKEFsZ2VicmFpY1R5cGUuSTY0KTtcbiAgfVxuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IEk2NENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgSTY0Q29sdW1uQnVpbGRlcih0aGlzLCBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgSTY0Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgYXV0b0luYygpIHtcbiAgICByZXR1cm4gbmV3IEk2NENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc0F1dG9JbmNyZW1lbnQ6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IEk2NENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBkZWZhdWx0VmFsdWU6IHZhbHVlIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IEk2NENvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBuYW1lIH0pKTtcbiAgfVxufTtcbnZhciBJMTI4QnVpbGRlciA9IGNsYXNzIGV4dGVuZHMgVHlwZUJ1aWxkZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihBbGdlYnJhaWNUeXBlLkkxMjgpO1xuICB9XG4gIGluZGV4KGFsZ29yaXRobSA9IFwiYnRyZWVcIikge1xuICAgIHJldHVybiBuZXcgSTEyOENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgSTEyOENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IEkxMjhDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaXNQcmltYXJ5S2V5OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBhdXRvSW5jKCkge1xuICAgIHJldHVybiBuZXcgSTEyOENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc0F1dG9JbmNyZW1lbnQ6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IEkxMjhDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBJMTI4Q29sdW1uQnVpbGRlcih0aGlzLCBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IG5hbWUgfSkpO1xuICB9XG59O1xudmFyIEkyNTZCdWlsZGVyID0gY2xhc3MgZXh0ZW5kcyBUeXBlQnVpbGRlciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKEFsZ2VicmFpY1R5cGUuSTI1Nik7XG4gIH1cbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBJMjU2Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICB1bmlxdWUoKSB7XG4gICAgcmV0dXJuIG5ldyBJMjU2Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgSTI1NkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGF1dG9JbmMoKSB7XG4gICAgcmV0dXJuIG5ldyBJMjU2Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzQXV0b0luY3JlbWVudDogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgSTI1NkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBkZWZhdWx0VmFsdWU6IHZhbHVlIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IEkyNTZDb2x1bW5CdWlsZGVyKHRoaXMsIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgbmFtZSB9KSk7XG4gIH1cbn07XG52YXIgRjMyQnVpbGRlciA9IGNsYXNzIGV4dGVuZHMgVHlwZUJ1aWxkZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihBbGdlYnJhaWNUeXBlLkYzMik7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgRjMyQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGRlZmF1bHRWYWx1ZTogdmFsdWUgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgRjMyQ29sdW1uQnVpbGRlcih0aGlzLCBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IG5hbWUgfSkpO1xuICB9XG59O1xudmFyIEY2NEJ1aWxkZXIgPSBjbGFzcyBleHRlbmRzIFR5cGVCdWlsZGVyIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoQWxnZWJyYWljVHlwZS5GNjQpO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IEY2NENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBkZWZhdWx0VmFsdWU6IHZhbHVlIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IEY2NENvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBuYW1lIH0pKTtcbiAgfVxufTtcbnZhciBCb29sQnVpbGRlciA9IGNsYXNzIGV4dGVuZHMgVHlwZUJ1aWxkZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihBbGdlYnJhaWNUeXBlLkJvb2wpO1xuICB9XG4gIGluZGV4KGFsZ29yaXRobSA9IFwiYnRyZWVcIikge1xuICAgIHJldHVybiBuZXcgQm9vbENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgQm9vbENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IEJvb2xDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaXNQcmltYXJ5S2V5OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBCb29sQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGRlZmF1bHRWYWx1ZTogdmFsdWUgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgQm9vbENvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBuYW1lIH0pKTtcbiAgfVxufTtcbnZhciBTdHJpbmdCdWlsZGVyID0gY2xhc3MgZXh0ZW5kcyBUeXBlQnVpbGRlciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKEFsZ2VicmFpY1R5cGUuU3RyaW5nKTtcbiAgfVxuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IFN0cmluZ0NvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgU3RyaW5nQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgU3RyaW5nQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgU3RyaW5nQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGRlZmF1bHRWYWx1ZTogdmFsdWUgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgU3RyaW5nQ29sdW1uQnVpbGRlcih0aGlzLCBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IG5hbWUgfSkpO1xuICB9XG59O1xudmFyIEFycmF5QnVpbGRlciA9IGNsYXNzIGV4dGVuZHMgVHlwZUJ1aWxkZXIge1xuICBlbGVtZW50O1xuICBjb25zdHJ1Y3RvcihlbGVtZW50KSB7XG4gICAgc3VwZXIoQWxnZWJyYWljVHlwZS5BcnJheShlbGVtZW50LmFsZ2VicmFpY1R5cGUpKTtcbiAgICB0aGlzLmVsZW1lbnQgPSBlbGVtZW50O1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IEFycmF5Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGRlZmF1bHRWYWx1ZTogdmFsdWUgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgQXJyYXlDb2x1bW5CdWlsZGVyKHRoaXMsIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgbmFtZSB9KSk7XG4gIH1cbn07XG52YXIgQnl0ZUFycmF5QnVpbGRlciA9IGNsYXNzIGV4dGVuZHMgVHlwZUJ1aWxkZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihBbGdlYnJhaWNUeXBlLkFycmF5KEFsZ2VicmFpY1R5cGUuVTgpKTtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBCeXRlQXJyYXlDb2x1bW5CdWlsZGVyKFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBkZWZhdWx0VmFsdWU6IHZhbHVlIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IEJ5dGVBcnJheUNvbHVtbkJ1aWxkZXIoc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBuYW1lIH0pKTtcbiAgfVxufTtcbnZhciBPcHRpb25CdWlsZGVyID0gY2xhc3MgZXh0ZW5kcyBUeXBlQnVpbGRlciB7XG4gIHZhbHVlO1xuICBjb25zdHJ1Y3Rvcih2YWx1ZSkge1xuICAgIHN1cGVyKE9wdGlvbi5nZXRBbGdlYnJhaWNUeXBlKHZhbHVlLmFsZ2VicmFpY1R5cGUpKTtcbiAgICB0aGlzLnZhbHVlID0gdmFsdWU7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgT3B0aW9uQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGRlZmF1bHRWYWx1ZTogdmFsdWUgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgT3B0aW9uQ29sdW1uQnVpbGRlcih0aGlzLCBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IG5hbWUgfSkpO1xuICB9XG59O1xudmFyIFByb2R1Y3RCdWlsZGVyID0gY2xhc3MgZXh0ZW5kcyBUeXBlQnVpbGRlciB7XG4gIHR5cGVOYW1lO1xuICBlbGVtZW50cztcbiAgY29uc3RydWN0b3IoZWxlbWVudHMsIG5hbWUpIHtcbiAgICBmdW5jdGlvbiBlbGVtZW50c0FycmF5RnJvbUVsZW1lbnRzT2JqKG9iaikge1xuICAgICAgcmV0dXJuIE9iamVjdC5rZXlzKG9iaikubWFwKChrZXkpID0+ICh7XG4gICAgICAgIG5hbWU6IGtleSxcbiAgICAgICAgLy8gTGF6aWx5IHJlc29sdmUgdGhlIHVuZGVybHlpbmcgb2JqZWN0J3MgYWxnZWJyYWljVHlwZS5cbiAgICAgICAgLy8gVGhpcyB3aWxsIGNhbGwgb2JqW2tleV0uYWxnZWJyYWljVHlwZSBvbmx5IHdoZW4gc29tZW9uZVxuICAgICAgICAvLyBhY3R1YWxseSByZWFkcyB0aGlzIHByb3BlcnR5LlxuICAgICAgICBnZXQgYWxnZWJyYWljVHlwZSgpIHtcbiAgICAgICAgICByZXR1cm4gb2JqW2tleV0uYWxnZWJyYWljVHlwZTtcbiAgICAgICAgfVxuICAgICAgfSkpO1xuICAgIH1cbiAgICBzdXBlcihcbiAgICAgIEFsZ2VicmFpY1R5cGUuUHJvZHVjdCh7XG4gICAgICAgIGVsZW1lbnRzOiBlbGVtZW50c0FycmF5RnJvbUVsZW1lbnRzT2JqKGVsZW1lbnRzKVxuICAgICAgfSlcbiAgICApO1xuICAgIHRoaXMudHlwZU5hbWUgPSBuYW1lO1xuICAgIHRoaXMuZWxlbWVudHMgPSBlbGVtZW50cztcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9kdWN0Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGRlZmF1bHRWYWx1ZTogdmFsdWUgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgUHJvZHVjdENvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBuYW1lIH0pKTtcbiAgfVxufTtcbnZhciBSZXN1bHRCdWlsZGVyID0gY2xhc3MgZXh0ZW5kcyBUeXBlQnVpbGRlciB7XG4gIG9rO1xuICBlcnI7XG4gIGNvbnN0cnVjdG9yKG9rLCBlcnIpIHtcbiAgICBzdXBlcihSZXN1bHQuZ2V0QWxnZWJyYWljVHlwZShvay5hbGdlYnJhaWNUeXBlLCBlcnIuYWxnZWJyYWljVHlwZSkpO1xuICAgIHRoaXMub2sgPSBvaztcbiAgICB0aGlzLmVyciA9IGVycjtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBSZXN1bHRDb2x1bW5CdWlsZGVyKHRoaXMsIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KSk7XG4gIH1cbn07XG52YXIgVW5pdEJ1aWxkZXIgPSBjbGFzcyBleHRlbmRzIFR5cGVCdWlsZGVyIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoeyB0YWc6IFwiUHJvZHVjdFwiLCB2YWx1ZTogeyBlbGVtZW50czogW10gfSB9KTtcbiAgfVxufTtcbnZhciBSb3dCdWlsZGVyID0gY2xhc3MgZXh0ZW5kcyBUeXBlQnVpbGRlciB7XG4gIHJvdztcbiAgdHlwZU5hbWU7XG4gIGNvbnN0cnVjdG9yKHJvdywgbmFtZSkge1xuICAgIGNvbnN0IG1hcHBlZFJvdyA9IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgIE9iamVjdC5lbnRyaWVzKHJvdykubWFwKChbY29sTmFtZSwgYnVpbGRlcl0pID0+IFtcbiAgICAgICAgY29sTmFtZSxcbiAgICAgICAgYnVpbGRlciBpbnN0YW5jZW9mIENvbHVtbkJ1aWxkZXIgPyBidWlsZGVyIDogbmV3IENvbHVtbkJ1aWxkZXIoYnVpbGRlciwge30pXG4gICAgICBdKVxuICAgICk7XG4gICAgY29uc3QgZWxlbWVudHMgPSBPYmplY3Qua2V5cyhtYXBwZWRSb3cpLm1hcCgobmFtZTIpID0+ICh7XG4gICAgICBuYW1lOiBuYW1lMixcbiAgICAgIGdldCBhbGdlYnJhaWNUeXBlKCkge1xuICAgICAgICByZXR1cm4gbWFwcGVkUm93W25hbWUyXS50eXBlQnVpbGRlci5hbGdlYnJhaWNUeXBlO1xuICAgICAgfVxuICAgIH0pKTtcbiAgICBzdXBlcihBbGdlYnJhaWNUeXBlLlByb2R1Y3QoeyBlbGVtZW50cyB9KSk7XG4gICAgdGhpcy5yb3cgPSBtYXBwZWRSb3c7XG4gICAgdGhpcy50eXBlTmFtZSA9IG5hbWU7XG4gIH1cbn07XG52YXIgU3VtQnVpbGRlckltcGwgPSBjbGFzcyBleHRlbmRzIFR5cGVCdWlsZGVyIHtcbiAgdmFyaWFudHM7XG4gIHR5cGVOYW1lO1xuICBjb25zdHJ1Y3Rvcih2YXJpYW50cywgbmFtZSkge1xuICAgIGZ1bmN0aW9uIHZhcmlhbnRzQXJyYXlGcm9tVmFyaWFudHNPYmoodmFyaWFudHMyKSB7XG4gICAgICByZXR1cm4gT2JqZWN0LmtleXModmFyaWFudHMyKS5tYXAoKGtleSkgPT4gKHtcbiAgICAgICAgbmFtZToga2V5LFxuICAgICAgICAvLyBMYXppbHkgcmVzb2x2ZSB0aGUgdW5kZXJseWluZyBvYmplY3QncyBhbGdlYnJhaWNUeXBlLlxuICAgICAgICAvLyBUaGlzIHdpbGwgY2FsbCBvYmpba2V5XS5hbGdlYnJhaWNUeXBlIG9ubHkgd2hlbiBzb21lb25lXG4gICAgICAgIC8vIGFjdHVhbGx5IHJlYWRzIHRoaXMgcHJvcGVydHkuXG4gICAgICAgIGdldCBhbGdlYnJhaWNUeXBlKCkge1xuICAgICAgICAgIHJldHVybiB2YXJpYW50czJba2V5XS5hbGdlYnJhaWNUeXBlO1xuICAgICAgICB9XG4gICAgICB9KSk7XG4gICAgfVxuICAgIHN1cGVyKFxuICAgICAgQWxnZWJyYWljVHlwZS5TdW0oe1xuICAgICAgICB2YXJpYW50czogdmFyaWFudHNBcnJheUZyb21WYXJpYW50c09iaih2YXJpYW50cylcbiAgICAgIH0pXG4gICAgKTtcbiAgICB0aGlzLnZhcmlhbnRzID0gdmFyaWFudHM7XG4gICAgdGhpcy50eXBlTmFtZSA9IG5hbWU7XG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXModmFyaWFudHMpKSB7XG4gICAgICBjb25zdCBkZXNjID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcih2YXJpYW50cywga2V5KTtcbiAgICAgIGNvbnN0IGlzQWNjZXNzb3IgPSAhIWRlc2MgJiYgKHR5cGVvZiBkZXNjLmdldCA9PT0gXCJmdW5jdGlvblwiIHx8IHR5cGVvZiBkZXNjLnNldCA9PT0gXCJmdW5jdGlvblwiKTtcbiAgICAgIGxldCBpc1VuaXQyID0gZmFsc2U7XG4gICAgICBpZiAoIWlzQWNjZXNzb3IpIHtcbiAgICAgICAgY29uc3QgdmFyaWFudCA9IHZhcmlhbnRzW2tleV07XG4gICAgICAgIGlzVW5pdDIgPSB2YXJpYW50IGluc3RhbmNlb2YgVW5pdEJ1aWxkZXI7XG4gICAgICB9XG4gICAgICBpZiAoaXNVbml0Mikge1xuICAgICAgICBjb25zdCBjb25zdGFudCA9IHRoaXMuY3JlYXRlKGtleSk7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCBrZXksIHtcbiAgICAgICAgICB2YWx1ZTogY29uc3RhbnQsXG4gICAgICAgICAgd3JpdGFibGU6IGZhbHNlLFxuICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgICAgY29uZmlndXJhYmxlOiBmYWxzZVxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGZuID0gKCh2YWx1ZSkgPT4gdGhpcy5jcmVhdGUoa2V5LCB2YWx1ZSkpO1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywga2V5LCB7XG4gICAgICAgICAgdmFsdWU6IGZuLFxuICAgICAgICAgIHdyaXRhYmxlOiBmYWxzZSxcbiAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICAgIGNvbmZpZ3VyYWJsZTogZmFsc2VcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGNyZWF0ZSh0YWcsIHZhbHVlKSB7XG4gICAgcmV0dXJuIHZhbHVlID09PSB2b2lkIDAgPyB7IHRhZyB9IDogeyB0YWcsIHZhbHVlIH07XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgU3VtQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGRlZmF1bHRWYWx1ZTogdmFsdWUgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgU3VtQ29sdW1uQnVpbGRlcih0aGlzLCBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IG5hbWUgfSkpO1xuICB9XG4gIGluZGV4KGFsZ29yaXRobSA9IFwiYnRyZWVcIikge1xuICAgIHJldHVybiBuZXcgU3VtQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgU3VtQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbn07XG52YXIgU3VtQnVpbGRlciA9IFN1bUJ1aWxkZXJJbXBsO1xudmFyIFNpbXBsZVN1bUJ1aWxkZXJJbXBsID0gY2xhc3MgZXh0ZW5kcyBTdW1CdWlsZGVySW1wbCB7XG4gIGluZGV4KGFsZ29yaXRobSA9IFwiYnRyZWVcIikge1xuICAgIHJldHVybiBuZXcgU2ltcGxlU3VtQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgU2ltcGxlU3VtQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbn07XG52YXIgU2ltcGxlU3VtQnVpbGRlciA9IFNpbXBsZVN1bUJ1aWxkZXJJbXBsO1xudmFyIFNjaGVkdWxlQXRCdWlsZGVyID0gY2xhc3MgZXh0ZW5kcyBUeXBlQnVpbGRlciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKHNjaGVkdWxlX2F0X2RlZmF1bHQuZ2V0QWxnZWJyYWljVHlwZSgpKTtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBTY2hlZHVsZUF0Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGRlZmF1bHRWYWx1ZTogdmFsdWUgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgU2NoZWR1bGVBdENvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBuYW1lIH0pKTtcbiAgfVxufTtcbnZhciBJZGVudGl0eUJ1aWxkZXIgPSBjbGFzcyBleHRlbmRzIFR5cGVCdWlsZGVyIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoSWRlbnRpdHkuZ2V0QWxnZWJyYWljVHlwZSgpKTtcbiAgfVxuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IElkZW50aXR5Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICB1bmlxdWUoKSB7XG4gICAgcmV0dXJuIG5ldyBJZGVudGl0eUNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IElkZW50aXR5Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgYXV0b0luYygpIHtcbiAgICByZXR1cm4gbmV3IElkZW50aXR5Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzQXV0b0luY3JlbWVudDogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgSWRlbnRpdHlDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBJZGVudGl0eUNvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBuYW1lIH0pKTtcbiAgfVxufTtcbnZhciBDb25uZWN0aW9uSWRCdWlsZGVyID0gY2xhc3MgZXh0ZW5kcyBUeXBlQnVpbGRlciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKENvbm5lY3Rpb25JZC5nZXRBbGdlYnJhaWNUeXBlKCkpO1xuICB9XG4gIGluZGV4KGFsZ29yaXRobSA9IFwiYnRyZWVcIikge1xuICAgIHJldHVybiBuZXcgQ29ubmVjdGlvbklkQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICB1bmlxdWUoKSB7XG4gICAgcmV0dXJuIG5ldyBDb25uZWN0aW9uSWRDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaXNVbmlxdWU6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIHByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIG5ldyBDb25uZWN0aW9uSWRDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaXNQcmltYXJ5S2V5OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBhdXRvSW5jKCkge1xuICAgIHJldHVybiBuZXcgQ29ubmVjdGlvbklkQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzQXV0b0luY3JlbWVudDogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgQ29ubmVjdGlvbklkQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGRlZmF1bHRWYWx1ZTogdmFsdWUgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgQ29ubmVjdGlvbklkQ29sdW1uQnVpbGRlcih0aGlzLCBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IG5hbWUgfSkpO1xuICB9XG59O1xudmFyIFRpbWVzdGFtcEJ1aWxkZXIgPSBjbGFzcyBleHRlbmRzIFR5cGVCdWlsZGVyIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoVGltZXN0YW1wLmdldEFsZ2VicmFpY1R5cGUoKSk7XG4gIH1cbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBUaW1lc3RhbXBDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaW5kZXhUeXBlOiBhbGdvcml0aG0gfSlcbiAgICApO1xuICB9XG4gIHVuaXF1ZSgpIHtcbiAgICByZXR1cm4gbmV3IFRpbWVzdGFtcENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IFRpbWVzdGFtcENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGF1dG9JbmMoKSB7XG4gICAgcmV0dXJuIG5ldyBUaW1lc3RhbXBDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgaXNBdXRvSW5jcmVtZW50OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBUaW1lc3RhbXBDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcyxcbiAgICAgIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBUaW1lc3RhbXBDb2x1bW5CdWlsZGVyKHRoaXMsIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgbmFtZSB9KSk7XG4gIH1cbn07XG52YXIgVGltZUR1cmF0aW9uQnVpbGRlciA9IGNsYXNzIGV4dGVuZHMgVHlwZUJ1aWxkZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihUaW1lRHVyYXRpb24uZ2V0QWxnZWJyYWljVHlwZSgpKTtcbiAgfVxuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IFRpbWVEdXJhdGlvbkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgVGltZUR1cmF0aW9uQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgVGltZUR1cmF0aW9uQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgYXV0b0luYygpIHtcbiAgICByZXR1cm4gbmV3IFRpbWVEdXJhdGlvbkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc0F1dG9JbmNyZW1lbnQ6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IFRpbWVEdXJhdGlvbkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBkZWZhdWx0VmFsdWU6IHZhbHVlIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IFRpbWVEdXJhdGlvbkNvbHVtbkJ1aWxkZXIodGhpcywgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBuYW1lIH0pKTtcbiAgfVxufTtcbnZhciBVdWlkQnVpbGRlciA9IGNsYXNzIGV4dGVuZHMgVHlwZUJ1aWxkZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcihVdWlkLmdldEFsZ2VicmFpY1R5cGUoKSk7XG4gIH1cbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBVdWlkQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICB1bmlxdWUoKSB7XG4gICAgcmV0dXJuIG5ldyBVdWlkQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgVXVpZENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGF1dG9JbmMoKSB7XG4gICAgcmV0dXJuIG5ldyBVdWlkQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMsXG4gICAgICBzZXQoZGVmYXVsdE1ldGFkYXRhLCB7IGlzQXV0b0luY3JlbWVudDogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgVXVpZENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLFxuICAgICAgc2V0KGRlZmF1bHRNZXRhZGF0YSwgeyBkZWZhdWx0VmFsdWU6IHZhbHVlIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IFV1aWRDb2x1bW5CdWlsZGVyKHRoaXMsIHNldChkZWZhdWx0TWV0YWRhdGEsIHsgbmFtZSB9KSk7XG4gIH1cbn07XG52YXIgZGVmYXVsdE1ldGFkYXRhID0ge307XG52YXIgQ29sdW1uQnVpbGRlciA9IGNsYXNzIHtcbiAgdHlwZUJ1aWxkZXI7XG4gIGNvbHVtbk1ldGFkYXRhO1xuICBjb25zdHJ1Y3Rvcih0eXBlQnVpbGRlciwgbWV0YWRhdGEpIHtcbiAgICB0aGlzLnR5cGVCdWlsZGVyID0gdHlwZUJ1aWxkZXI7XG4gICAgdGhpcy5jb2x1bW5NZXRhZGF0YSA9IG1ldGFkYXRhO1xuICB9XG4gIHNlcmlhbGl6ZSh3cml0ZXIsIHZhbHVlKSB7XG4gICAgdGhpcy50eXBlQnVpbGRlci5zZXJpYWxpemUod3JpdGVyLCB2YWx1ZSk7XG4gIH1cbiAgZGVzZXJpYWxpemUocmVhZGVyKSB7XG4gICAgcmV0dXJuIHRoaXMudHlwZUJ1aWxkZXIuZGVzZXJpYWxpemUocmVhZGVyKTtcbiAgfVxufTtcbnZhciBVOENvbHVtbkJ1aWxkZXIgPSBjbGFzcyBfVThDb2x1bW5CdWlsZGVyIGV4dGVuZHMgQ29sdW1uQnVpbGRlciB7XG4gIGluZGV4KGFsZ29yaXRobSA9IFwiYnRyZWVcIikge1xuICAgIHJldHVybiBuZXcgX1U4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgX1U4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IF9VOENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNQcmltYXJ5S2V5OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBhdXRvSW5jKCkge1xuICAgIHJldHVybiBuZXcgX1U4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc0F1dG9JbmNyZW1lbnQ6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IF9VOENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHtcbiAgICAgICAgZGVmYXVsdFZhbHVlOiB2YWx1ZVxuICAgICAgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgX1U4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBuYW1lIH0pXG4gICAgKTtcbiAgfVxufTtcbnZhciBVMTZDb2x1bW5CdWlsZGVyID0gY2xhc3MgX1UxNkNvbHVtbkJ1aWxkZXIgZXh0ZW5kcyBDb2x1bW5CdWlsZGVyIHtcbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBfVTE2Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgX1UxNkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNVbmlxdWU6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIHByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIG5ldyBfVTE2Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGF1dG9JbmMoKSB7XG4gICAgcmV0dXJuIG5ldyBfVTE2Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc0F1dG9JbmNyZW1lbnQ6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IF9VMTZDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7XG4gICAgICAgIGRlZmF1bHRWYWx1ZTogdmFsdWVcbiAgICAgIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IF9VMTZDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IG5hbWUgfSlcbiAgICApO1xuICB9XG59O1xudmFyIFUzMkNvbHVtbkJ1aWxkZXIgPSBjbGFzcyBfVTMyQ29sdW1uQnVpbGRlciBleHRlbmRzIENvbHVtbkJ1aWxkZXIge1xuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IF9VMzJDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICB1bmlxdWUoKSB7XG4gICAgcmV0dXJuIG5ldyBfVTMyQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IF9VMzJDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgYXV0b0luYygpIHtcbiAgICByZXR1cm4gbmV3IF9VMzJDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzQXV0b0luY3JlbWVudDogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgX1UzMkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHtcbiAgICAgICAgZGVmYXVsdFZhbHVlOiB2YWx1ZVxuICAgICAgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgX1UzMkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgbmFtZSB9KVxuICAgICk7XG4gIH1cbn07XG52YXIgVTY0Q29sdW1uQnVpbGRlciA9IGNsYXNzIF9VNjRDb2x1bW5CdWlsZGVyIGV4dGVuZHMgQ29sdW1uQnVpbGRlciB7XG4gIGluZGV4KGFsZ29yaXRobSA9IFwiYnRyZWVcIikge1xuICAgIHJldHVybiBuZXcgX1U2NENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaW5kZXhUeXBlOiBhbGdvcml0aG0gfSlcbiAgICApO1xuICB9XG4gIHVuaXF1ZSgpIHtcbiAgICByZXR1cm4gbmV3IF9VNjRDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgX1U2NENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNQcmltYXJ5S2V5OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBhdXRvSW5jKCkge1xuICAgIHJldHVybiBuZXcgX1U2NENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNBdXRvSW5jcmVtZW50OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBfVTY0Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwge1xuICAgICAgICBkZWZhdWx0VmFsdWU6IHZhbHVlXG4gICAgICB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBfVTY0Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBuYW1lIH0pXG4gICAgKTtcbiAgfVxufTtcbnZhciBVMTI4Q29sdW1uQnVpbGRlciA9IGNsYXNzIF9VMTI4Q29sdW1uQnVpbGRlciBleHRlbmRzIENvbHVtbkJ1aWxkZXIge1xuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IF9VMTI4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgX1UxMjhDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgX1UxMjhDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgYXV0b0luYygpIHtcbiAgICByZXR1cm4gbmV3IF9VMTI4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc0F1dG9JbmNyZW1lbnQ6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IF9VMTI4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwge1xuICAgICAgICBkZWZhdWx0VmFsdWU6IHZhbHVlXG4gICAgICB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBfVTEyOENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgbmFtZSB9KVxuICAgICk7XG4gIH1cbn07XG52YXIgVTI1NkNvbHVtbkJ1aWxkZXIgPSBjbGFzcyBfVTI1NkNvbHVtbkJ1aWxkZXIgZXh0ZW5kcyBDb2x1bW5CdWlsZGVyIHtcbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBfVTI1NkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaW5kZXhUeXBlOiBhbGdvcml0aG0gfSlcbiAgICApO1xuICB9XG4gIHVuaXF1ZSgpIHtcbiAgICByZXR1cm4gbmV3IF9VMjU2Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IF9VMjU2Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGF1dG9JbmMoKSB7XG4gICAgcmV0dXJuIG5ldyBfVTI1NkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNBdXRvSW5jcmVtZW50OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBfVTI1NkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHtcbiAgICAgICAgZGVmYXVsdFZhbHVlOiB2YWx1ZVxuICAgICAgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgX1UyNTZDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IG5hbWUgfSlcbiAgICApO1xuICB9XG59O1xudmFyIEk4Q29sdW1uQnVpbGRlciA9IGNsYXNzIF9JOENvbHVtbkJ1aWxkZXIgZXh0ZW5kcyBDb2x1bW5CdWlsZGVyIHtcbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBfSThDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICB1bmlxdWUoKSB7XG4gICAgcmV0dXJuIG5ldyBfSThDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgX0k4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGF1dG9JbmMoKSB7XG4gICAgcmV0dXJuIG5ldyBfSThDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzQXV0b0luY3JlbWVudDogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgX0k4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwge1xuICAgICAgICBkZWZhdWx0VmFsdWU6IHZhbHVlXG4gICAgICB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBfSThDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IG5hbWUgfSlcbiAgICApO1xuICB9XG59O1xudmFyIEkxNkNvbHVtbkJ1aWxkZXIgPSBjbGFzcyBfSTE2Q29sdW1uQnVpbGRlciBleHRlbmRzIENvbHVtbkJ1aWxkZXIge1xuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IF9JMTZDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICB1bmlxdWUoKSB7XG4gICAgcmV0dXJuIG5ldyBfSTE2Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IF9JMTZDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgYXV0b0luYygpIHtcbiAgICByZXR1cm4gbmV3IF9JMTZDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzQXV0b0luY3JlbWVudDogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgX0kxNkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHtcbiAgICAgICAgZGVmYXVsdFZhbHVlOiB2YWx1ZVxuICAgICAgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgX0kxNkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgbmFtZSB9KVxuICAgICk7XG4gIH1cbn07XG52YXIgSTMyQ29sdW1uQnVpbGRlciA9IGNsYXNzIF9JMzJDb2x1bW5CdWlsZGVyIGV4dGVuZHMgQ29sdW1uQnVpbGRlciB7XG4gIGluZGV4KGFsZ29yaXRobSA9IFwiYnRyZWVcIikge1xuICAgIHJldHVybiBuZXcgX0kzMkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaW5kZXhUeXBlOiBhbGdvcml0aG0gfSlcbiAgICApO1xuICB9XG4gIHVuaXF1ZSgpIHtcbiAgICByZXR1cm4gbmV3IF9JMzJDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgX0kzMkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNQcmltYXJ5S2V5OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBhdXRvSW5jKCkge1xuICAgIHJldHVybiBuZXcgX0kzMkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNBdXRvSW5jcmVtZW50OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBfSTMyQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwge1xuICAgICAgICBkZWZhdWx0VmFsdWU6IHZhbHVlXG4gICAgICB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBfSTMyQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBuYW1lIH0pXG4gICAgKTtcbiAgfVxufTtcbnZhciBJNjRDb2x1bW5CdWlsZGVyID0gY2xhc3MgX0k2NENvbHVtbkJ1aWxkZXIgZXh0ZW5kcyBDb2x1bW5CdWlsZGVyIHtcbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBfSTY0Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgX0k2NENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNVbmlxdWU6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIHByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIG5ldyBfSTY0Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGF1dG9JbmMoKSB7XG4gICAgcmV0dXJuIG5ldyBfSTY0Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc0F1dG9JbmNyZW1lbnQ6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IF9JNjRDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7XG4gICAgICAgIGRlZmF1bHRWYWx1ZTogdmFsdWVcbiAgICAgIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IF9JNjRDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IG5hbWUgfSlcbiAgICApO1xuICB9XG59O1xudmFyIEkxMjhDb2x1bW5CdWlsZGVyID0gY2xhc3MgX0kxMjhDb2x1bW5CdWlsZGVyIGV4dGVuZHMgQ29sdW1uQnVpbGRlciB7XG4gIGluZGV4KGFsZ29yaXRobSA9IFwiYnRyZWVcIikge1xuICAgIHJldHVybiBuZXcgX0kxMjhDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICB1bmlxdWUoKSB7XG4gICAgcmV0dXJuIG5ldyBfSTEyOENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNVbmlxdWU6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIHByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIG5ldyBfSTEyOENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNQcmltYXJ5S2V5OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBhdXRvSW5jKCkge1xuICAgIHJldHVybiBuZXcgX0kxMjhDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzQXV0b0luY3JlbWVudDogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgX0kxMjhDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7XG4gICAgICAgIGRlZmF1bHRWYWx1ZTogdmFsdWVcbiAgICAgIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IF9JMTI4Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBuYW1lIH0pXG4gICAgKTtcbiAgfVxufTtcbnZhciBJMjU2Q29sdW1uQnVpbGRlciA9IGNsYXNzIF9JMjU2Q29sdW1uQnVpbGRlciBleHRlbmRzIENvbHVtbkJ1aWxkZXIge1xuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IF9JMjU2Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgX0kyNTZDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgX0kyNTZDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgYXV0b0luYygpIHtcbiAgICByZXR1cm4gbmV3IF9JMjU2Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc0F1dG9JbmNyZW1lbnQ6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IF9JMjU2Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwge1xuICAgICAgICBkZWZhdWx0VmFsdWU6IHZhbHVlXG4gICAgICB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBfSTI1NkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgbmFtZSB9KVxuICAgICk7XG4gIH1cbn07XG52YXIgRjMyQ29sdW1uQnVpbGRlciA9IGNsYXNzIF9GMzJDb2x1bW5CdWlsZGVyIGV4dGVuZHMgQ29sdW1uQnVpbGRlciB7XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IF9GMzJDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7XG4gICAgICAgIGRlZmF1bHRWYWx1ZTogdmFsdWVcbiAgICAgIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IF9GMzJDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IG5hbWUgfSlcbiAgICApO1xuICB9XG59O1xudmFyIEY2NENvbHVtbkJ1aWxkZXIgPSBjbGFzcyBfRjY0Q29sdW1uQnVpbGRlciBleHRlbmRzIENvbHVtbkJ1aWxkZXIge1xuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBfRjY0Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwge1xuICAgICAgICBkZWZhdWx0VmFsdWU6IHZhbHVlXG4gICAgICB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBfRjY0Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBuYW1lIH0pXG4gICAgKTtcbiAgfVxufTtcbnZhciBCb29sQ29sdW1uQnVpbGRlciA9IGNsYXNzIF9Cb29sQ29sdW1uQnVpbGRlciBleHRlbmRzIENvbHVtbkJ1aWxkZXIge1xuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IF9Cb29sQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgX0Jvb2xDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgX0Jvb2xDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgX0Jvb2xDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7XG4gICAgICAgIGRlZmF1bHRWYWx1ZTogdmFsdWVcbiAgICAgIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IF9Cb29sQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBuYW1lIH0pXG4gICAgKTtcbiAgfVxufTtcbnZhciBTdHJpbmdDb2x1bW5CdWlsZGVyID0gY2xhc3MgX1N0cmluZ0NvbHVtbkJ1aWxkZXIgZXh0ZW5kcyBDb2x1bW5CdWlsZGVyIHtcbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBfU3RyaW5nQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgX1N0cmluZ0NvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNVbmlxdWU6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIHByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIG5ldyBfU3RyaW5nQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IF9TdHJpbmdDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7XG4gICAgICAgIGRlZmF1bHRWYWx1ZTogdmFsdWVcbiAgICAgIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IF9TdHJpbmdDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IG5hbWUgfSlcbiAgICApO1xuICB9XG59O1xudmFyIEFycmF5Q29sdW1uQnVpbGRlciA9IGNsYXNzIF9BcnJheUNvbHVtbkJ1aWxkZXIgZXh0ZW5kcyBDb2x1bW5CdWlsZGVyIHtcbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgX0FycmF5Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwge1xuICAgICAgICBkZWZhdWx0VmFsdWU6IHZhbHVlXG4gICAgICB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBfQXJyYXlDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IG5hbWUgfSlcbiAgICApO1xuICB9XG59O1xudmFyIEJ5dGVBcnJheUNvbHVtbkJ1aWxkZXIgPSBjbGFzcyBfQnl0ZUFycmF5Q29sdW1uQnVpbGRlciBleHRlbmRzIENvbHVtbkJ1aWxkZXIge1xuICBjb25zdHJ1Y3RvcihtZXRhZGF0YSkge1xuICAgIHN1cGVyKG5ldyBUeXBlQnVpbGRlcihBbGdlYnJhaWNUeXBlLkFycmF5KEFsZ2VicmFpY1R5cGUuVTgpKSwgbWV0YWRhdGEpO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IF9CeXRlQXJyYXlDb2x1bW5CdWlsZGVyKFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBfQnl0ZUFycmF5Q29sdW1uQnVpbGRlcihzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBuYW1lIH0pKTtcbiAgfVxufTtcbnZhciBPcHRpb25Db2x1bW5CdWlsZGVyID0gY2xhc3MgX09wdGlvbkNvbHVtbkJ1aWxkZXIgZXh0ZW5kcyBDb2x1bW5CdWlsZGVyIHtcbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgX09wdGlvbkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHtcbiAgICAgICAgZGVmYXVsdFZhbHVlOiB2YWx1ZVxuICAgICAgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgX09wdGlvbkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgbmFtZSB9KVxuICAgICk7XG4gIH1cbn07XG52YXIgUmVzdWx0Q29sdW1uQnVpbGRlciA9IGNsYXNzIF9SZXN1bHRDb2x1bW5CdWlsZGVyIGV4dGVuZHMgQ29sdW1uQnVpbGRlciB7XG4gIGNvbnN0cnVjdG9yKHR5cGVCdWlsZGVyLCBtZXRhZGF0YSkge1xuICAgIHN1cGVyKHR5cGVCdWlsZGVyLCBtZXRhZGF0YSk7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgX1Jlc3VsdENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHtcbiAgICAgICAgZGVmYXVsdFZhbHVlOiB2YWx1ZVxuICAgICAgfSlcbiAgICApO1xuICB9XG59O1xudmFyIFByb2R1Y3RDb2x1bW5CdWlsZGVyID0gY2xhc3MgX1Byb2R1Y3RDb2x1bW5CdWlsZGVyIGV4dGVuZHMgQ29sdW1uQnVpbGRlciB7XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IF9Qcm9kdWN0Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBkZWZhdWx0VmFsdWU6IHZhbHVlIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IF9Qcm9kdWN0Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBuYW1lIH0pXG4gICAgKTtcbiAgfVxufTtcbnZhciBTdW1Db2x1bW5CdWlsZGVyID0gY2xhc3MgX1N1bUNvbHVtbkJ1aWxkZXIgZXh0ZW5kcyBDb2x1bW5CdWlsZGVyIHtcbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgX1N1bUNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBfU3VtQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBuYW1lIH0pXG4gICAgKTtcbiAgfVxuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IF9TdW1Db2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgX1N1bUNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNQcmltYXJ5S2V5OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxufTtcbnZhciBTaW1wbGVTdW1Db2x1bW5CdWlsZGVyID0gY2xhc3MgX1NpbXBsZVN1bUNvbHVtbkJ1aWxkZXIgZXh0ZW5kcyBTdW1Db2x1bW5CdWlsZGVyIHtcbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBfU2ltcGxlU3VtQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IF9TaW1wbGVTdW1Db2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbn07XG52YXIgU2NoZWR1bGVBdENvbHVtbkJ1aWxkZXIgPSBjbGFzcyBfU2NoZWR1bGVBdENvbHVtbkJ1aWxkZXIgZXh0ZW5kcyBDb2x1bW5CdWlsZGVyIHtcbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgX1NjaGVkdWxlQXRDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGRlZmF1bHRWYWx1ZTogdmFsdWUgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgX1NjaGVkdWxlQXRDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IG5hbWUgfSlcbiAgICApO1xuICB9XG59O1xudmFyIElkZW50aXR5Q29sdW1uQnVpbGRlciA9IGNsYXNzIF9JZGVudGl0eUNvbHVtbkJ1aWxkZXIgZXh0ZW5kcyBDb2x1bW5CdWlsZGVyIHtcbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBfSWRlbnRpdHlDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICB1bmlxdWUoKSB7XG4gICAgcmV0dXJuIG5ldyBfSWRlbnRpdHlDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgX0lkZW50aXR5Q29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IF9JZGVudGl0eUNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBfSWRlbnRpdHlDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IG5hbWUgfSlcbiAgICApO1xuICB9XG59O1xudmFyIENvbm5lY3Rpb25JZENvbHVtbkJ1aWxkZXIgPSBjbGFzcyBfQ29ubmVjdGlvbklkQ29sdW1uQnVpbGRlciBleHRlbmRzIENvbHVtbkJ1aWxkZXIge1xuICBpbmRleChhbGdvcml0aG0gPSBcImJ0cmVlXCIpIHtcbiAgICByZXR1cm4gbmV3IF9Db25uZWN0aW9uSWRDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICB1bmlxdWUoKSB7XG4gICAgcmV0dXJuIG5ldyBfQ29ubmVjdGlvbklkQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc1VuaXF1ZTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgcHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gbmV3IF9Db25uZWN0aW9uSWRDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzUHJpbWFyeUtleTogdHJ1ZSB9KVxuICAgICk7XG4gIH1cbiAgZGVmYXVsdCh2YWx1ZSkge1xuICAgIHJldHVybiBuZXcgX0Nvbm5lY3Rpb25JZENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBfQ29ubmVjdGlvbklkQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBuYW1lIH0pXG4gICAgKTtcbiAgfVxufTtcbnZhciBUaW1lc3RhbXBDb2x1bW5CdWlsZGVyID0gY2xhc3MgX1RpbWVzdGFtcENvbHVtbkJ1aWxkZXIgZXh0ZW5kcyBDb2x1bW5CdWlsZGVyIHtcbiAgaW5kZXgoYWxnb3JpdGhtID0gXCJidHJlZVwiKSB7XG4gICAgcmV0dXJuIG5ldyBfVGltZXN0YW1wQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpbmRleFR5cGU6IGFsZ29yaXRobSB9KVxuICAgICk7XG4gIH1cbiAgdW5pcXVlKCkge1xuICAgIHJldHVybiBuZXcgX1RpbWVzdGFtcENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNVbmlxdWU6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIHByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIG5ldyBfVGltZXN0YW1wQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBpc1ByaW1hcnlLZXk6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIGRlZmF1bHQodmFsdWUpIHtcbiAgICByZXR1cm4gbmV3IF9UaW1lc3RhbXBDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGRlZmF1bHRWYWx1ZTogdmFsdWUgfSlcbiAgICApO1xuICB9XG4gIG5hbWUobmFtZSkge1xuICAgIHJldHVybiBuZXcgX1RpbWVzdGFtcENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgbmFtZSB9KVxuICAgICk7XG4gIH1cbn07XG52YXIgVGltZUR1cmF0aW9uQ29sdW1uQnVpbGRlciA9IGNsYXNzIF9UaW1lRHVyYXRpb25Db2x1bW5CdWlsZGVyIGV4dGVuZHMgQ29sdW1uQnVpbGRlciB7XG4gIGluZGV4KGFsZ29yaXRobSA9IFwiYnRyZWVcIikge1xuICAgIHJldHVybiBuZXcgX1RpbWVEdXJhdGlvbkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaW5kZXhUeXBlOiBhbGdvcml0aG0gfSlcbiAgICApO1xuICB9XG4gIHVuaXF1ZSgpIHtcbiAgICByZXR1cm4gbmV3IF9UaW1lRHVyYXRpb25Db2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGlzVW5pcXVlOiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBwcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiBuZXcgX1RpbWVEdXJhdGlvbkNvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNQcmltYXJ5S2V5OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBfVGltZUR1cmF0aW9uQ29sdW1uQnVpbGRlcihcbiAgICAgIHRoaXMudHlwZUJ1aWxkZXIsXG4gICAgICBzZXQodGhpcy5jb2x1bW5NZXRhZGF0YSwgeyBkZWZhdWx0VmFsdWU6IHZhbHVlIH0pXG4gICAgKTtcbiAgfVxuICBuYW1lKG5hbWUpIHtcbiAgICByZXR1cm4gbmV3IF9UaW1lRHVyYXRpb25Db2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IG5hbWUgfSlcbiAgICApO1xuICB9XG59O1xudmFyIFV1aWRDb2x1bW5CdWlsZGVyID0gY2xhc3MgX1V1aWRDb2x1bW5CdWlsZGVyIGV4dGVuZHMgQ29sdW1uQnVpbGRlciB7XG4gIGluZGV4KGFsZ29yaXRobSA9IFwiYnRyZWVcIikge1xuICAgIHJldHVybiBuZXcgX1V1aWRDb2x1bW5CdWlsZGVyKFxuICAgICAgdGhpcy50eXBlQnVpbGRlcixcbiAgICAgIHNldCh0aGlzLmNvbHVtbk1ldGFkYXRhLCB7IGluZGV4VHlwZTogYWxnb3JpdGhtIH0pXG4gICAgKTtcbiAgfVxuICB1bmlxdWUoKSB7XG4gICAgcmV0dXJuIG5ldyBfVXVpZENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNVbmlxdWU6IHRydWUgfSlcbiAgICApO1xuICB9XG4gIHByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIG5ldyBfVXVpZENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgaXNQcmltYXJ5S2V5OiB0cnVlIH0pXG4gICAgKTtcbiAgfVxuICBkZWZhdWx0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBfVXVpZENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgZGVmYXVsdFZhbHVlOiB2YWx1ZSB9KVxuICAgICk7XG4gIH1cbiAgbmFtZShuYW1lKSB7XG4gICAgcmV0dXJuIG5ldyBfVXVpZENvbHVtbkJ1aWxkZXIoXG4gICAgICB0aGlzLnR5cGVCdWlsZGVyLFxuICAgICAgc2V0KHRoaXMuY29sdW1uTWV0YWRhdGEsIHsgbmFtZSB9KVxuICAgICk7XG4gIH1cbn07XG52YXIgUmVmQnVpbGRlciA9IGNsYXNzIGV4dGVuZHMgVHlwZUJ1aWxkZXIge1xuICByZWY7XG4gIC8qKiBUaGUgcGhhbnRvbSB0eXBlIG9mIHRoZSBwb2ludGVlIG9mIHRoaXMgcmVmLiAqL1xuICBfX3NwYWNldGltZVR5cGU7XG4gIGNvbnN0cnVjdG9yKHJlZikge1xuICAgIHN1cGVyKEFsZ2VicmFpY1R5cGUuUmVmKHJlZikpO1xuICAgIHRoaXMucmVmID0gcmVmO1xuICB9XG59O1xudmFyIGVudW1JbXBsID0gKChuYW1lT3JPYmosIG1heWJlT2JqKSA9PiB7XG4gIGxldCBvYmogPSBuYW1lT3JPYmo7XG4gIGxldCBuYW1lID0gdm9pZCAwO1xuICBpZiAodHlwZW9mIG5hbWVPck9iaiA9PT0gXCJzdHJpbmdcIikge1xuICAgIGlmICghbWF5YmVPYmopIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgIFwiV2hlbiBwcm92aWRpbmcgYSBuYW1lLCB5b3UgbXVzdCBhbHNvIHByb3ZpZGUgdGhlIHZhcmlhbnRzIG9iamVjdCBvciBhcnJheS5cIlxuICAgICAgKTtcbiAgICB9XG4gICAgb2JqID0gbWF5YmVPYmo7XG4gICAgbmFtZSA9IG5hbWVPck9iajtcbiAgfVxuICBpZiAoQXJyYXkuaXNBcnJheShvYmopKSB7XG4gICAgY29uc3Qgc2ltcGxlVmFyaWFudHNPYmogPSB7fTtcbiAgICBmb3IgKGNvbnN0IHZhcmlhbnQgb2Ygb2JqKSB7XG4gICAgICBzaW1wbGVWYXJpYW50c09ialt2YXJpYW50XSA9IG5ldyBVbml0QnVpbGRlcigpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFNpbXBsZVN1bUJ1aWxkZXJJbXBsKHNpbXBsZVZhcmlhbnRzT2JqLCBuYW1lKTtcbiAgfVxuICByZXR1cm4gbmV3IFN1bUJ1aWxkZXIob2JqLCBuYW1lKTtcbn0pO1xudmFyIHQgPSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGBCb29sYCB7QGxpbmsgQWxnZWJyYWljVHlwZX0gdG8gYmUgdXNlZCBpbiB0YWJsZSBkZWZpbml0aW9uc1xuICAgKiBSZXByZXNlbnRlZCBhcyBgYm9vbGVhbmAgaW4gVHlwZVNjcmlwdC5cbiAgICogQHJldHVybnMgQSBuZXcge0BsaW5rIEJvb2xCdWlsZGVyfSBpbnN0YW5jZVxuICAgKi9cbiAgYm9vbDogKCkgPT4gbmV3IEJvb2xCdWlsZGVyKCksXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGBTdHJpbmdgIHtAbGluayBBbGdlYnJhaWNUeXBlfSB0byBiZSB1c2VkIGluIHRhYmxlIGRlZmluaXRpb25zXG4gICAqIFJlcHJlc2VudGVkIGFzIGBzdHJpbmdgIGluIFR5cGVTY3JpcHQuXG4gICAqIEByZXR1cm5zIEEgbmV3IHtAbGluayBTdHJpbmdCdWlsZGVyfSBpbnN0YW5jZVxuICAgKi9cbiAgc3RyaW5nOiAoKSA9PiBuZXcgU3RyaW5nQnVpbGRlcigpLFxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBgRjY0YCB7QGxpbmsgQWxnZWJyYWljVHlwZX0gdG8gYmUgdXNlZCBpbiB0YWJsZSBkZWZpbml0aW9uc1xuICAgKiBSZXByZXNlbnRlZCBhcyBgbnVtYmVyYCBpbiBUeXBlU2NyaXB0LlxuICAgKiBAcmV0dXJucyBBIG5ldyB7QGxpbmsgRjY0QnVpbGRlcn0gaW5zdGFuY2VcbiAgICovXG4gIG51bWJlcjogKCkgPT4gbmV3IEY2NEJ1aWxkZXIoKSxcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgYEk4YCB7QGxpbmsgQWxnZWJyYWljVHlwZX0gdG8gYmUgdXNlZCBpbiB0YWJsZSBkZWZpbml0aW9uc1xuICAgKiBSZXByZXNlbnRlZCBhcyBgbnVtYmVyYCBpbiBUeXBlU2NyaXB0LlxuICAgKiBAcmV0dXJucyBBIG5ldyB7QGxpbmsgSThCdWlsZGVyfSBpbnN0YW5jZVxuICAgKi9cbiAgaTg6ICgpID0+IG5ldyBJOEJ1aWxkZXIoKSxcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgYFU4YCB7QGxpbmsgQWxnZWJyYWljVHlwZX0gdG8gYmUgdXNlZCBpbiB0YWJsZSBkZWZpbml0aW9uc1xuICAgKiBSZXByZXNlbnRlZCBhcyBgbnVtYmVyYCBpbiBUeXBlU2NyaXB0LlxuICAgKiBAcmV0dXJucyBBIG5ldyB7QGxpbmsgVThCdWlsZGVyfSBpbnN0YW5jZVxuICAgKi9cbiAgdTg6ICgpID0+IG5ldyBVOEJ1aWxkZXIoKSxcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgYEkxNmAge0BsaW5rIEFsZ2VicmFpY1R5cGV9IHRvIGJlIHVzZWQgaW4gdGFibGUgZGVmaW5pdGlvbnNcbiAgICogUmVwcmVzZW50ZWQgYXMgYG51bWJlcmAgaW4gVHlwZVNjcmlwdC5cbiAgICogQHJldHVybnMgQSBuZXcge0BsaW5rIEkxNkJ1aWxkZXJ9IGluc3RhbmNlXG4gICAqL1xuICBpMTY6ICgpID0+IG5ldyBJMTZCdWlsZGVyKCksXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGBVMTZgIHtAbGluayBBbGdlYnJhaWNUeXBlfSB0byBiZSB1c2VkIGluIHRhYmxlIGRlZmluaXRpb25zXG4gICAqIFJlcHJlc2VudGVkIGFzIGBudW1iZXJgIGluIFR5cGVTY3JpcHQuXG4gICAqIEByZXR1cm5zIEEgbmV3IHtAbGluayBVMTZCdWlsZGVyfSBpbnN0YW5jZVxuICAgKi9cbiAgdTE2OiAoKSA9PiBuZXcgVTE2QnVpbGRlcigpLFxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBgSTMyYCB7QGxpbmsgQWxnZWJyYWljVHlwZX0gdG8gYmUgdXNlZCBpbiB0YWJsZSBkZWZpbml0aW9uc1xuICAgKiBSZXByZXNlbnRlZCBhcyBgbnVtYmVyYCBpbiBUeXBlU2NyaXB0LlxuICAgKiBAcmV0dXJucyBBIG5ldyB7QGxpbmsgSTMyQnVpbGRlcn0gaW5zdGFuY2VcbiAgICovXG4gIGkzMjogKCkgPT4gbmV3IEkzMkJ1aWxkZXIoKSxcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgYFUzMmAge0BsaW5rIEFsZ2VicmFpY1R5cGV9IHRvIGJlIHVzZWQgaW4gdGFibGUgZGVmaW5pdGlvbnNcbiAgICogUmVwcmVzZW50ZWQgYXMgYG51bWJlcmAgaW4gVHlwZVNjcmlwdC5cbiAgICogQHJldHVybnMgQSBuZXcge0BsaW5rIFUzMkJ1aWxkZXJ9IGluc3RhbmNlXG4gICAqL1xuICB1MzI6ICgpID0+IG5ldyBVMzJCdWlsZGVyKCksXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGBJNjRgIHtAbGluayBBbGdlYnJhaWNUeXBlfSB0byBiZSB1c2VkIGluIHRhYmxlIGRlZmluaXRpb25zXG4gICAqIFJlcHJlc2VudGVkIGFzIGBiaWdpbnRgIGluIFR5cGVTY3JpcHQuXG4gICAqIEByZXR1cm5zIEEgbmV3IHtAbGluayBJNjRCdWlsZGVyfSBpbnN0YW5jZVxuICAgKi9cbiAgaTY0OiAoKSA9PiBuZXcgSTY0QnVpbGRlcigpLFxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBgVTY0YCB7QGxpbmsgQWxnZWJyYWljVHlwZX0gdG8gYmUgdXNlZCBpbiB0YWJsZSBkZWZpbml0aW9uc1xuICAgKiBSZXByZXNlbnRlZCBhcyBgYmlnaW50YCBpbiBUeXBlU2NyaXB0LlxuICAgKiBAcmV0dXJucyBBIG5ldyB7QGxpbmsgVTY0QnVpbGRlcn0gaW5zdGFuY2VcbiAgICovXG4gIHU2NDogKCkgPT4gbmV3IFU2NEJ1aWxkZXIoKSxcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgYEkxMjhgIHtAbGluayBBbGdlYnJhaWNUeXBlfSB0byBiZSB1c2VkIGluIHRhYmxlIGRlZmluaXRpb25zXG4gICAqIFJlcHJlc2VudGVkIGFzIGBiaWdpbnRgIGluIFR5cGVTY3JpcHQuXG4gICAqIEByZXR1cm5zIEEgbmV3IHtAbGluayBJMTI4QnVpbGRlcn0gaW5zdGFuY2VcbiAgICovXG4gIGkxMjg6ICgpID0+IG5ldyBJMTI4QnVpbGRlcigpLFxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBgVTEyOGAge0BsaW5rIEFsZ2VicmFpY1R5cGV9IHRvIGJlIHVzZWQgaW4gdGFibGUgZGVmaW5pdGlvbnNcbiAgICogUmVwcmVzZW50ZWQgYXMgYGJpZ2ludGAgaW4gVHlwZVNjcmlwdC5cbiAgICogQHJldHVybnMgQSBuZXcge0BsaW5rIFUxMjhCdWlsZGVyfSBpbnN0YW5jZVxuICAgKi9cbiAgdTEyODogKCkgPT4gbmV3IFUxMjhCdWlsZGVyKCksXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGBJMjU2YCB7QGxpbmsgQWxnZWJyYWljVHlwZX0gdG8gYmUgdXNlZCBpbiB0YWJsZSBkZWZpbml0aW9uc1xuICAgKiBSZXByZXNlbnRlZCBhcyBgYmlnaW50YCBpbiBUeXBlU2NyaXB0LlxuICAgKiBAcmV0dXJucyBBIG5ldyB7QGxpbmsgSTI1NkJ1aWxkZXJ9IGluc3RhbmNlXG4gICAqL1xuICBpMjU2OiAoKSA9PiBuZXcgSTI1NkJ1aWxkZXIoKSxcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgYFUyNTZgIHtAbGluayBBbGdlYnJhaWNUeXBlfSB0byBiZSB1c2VkIGluIHRhYmxlIGRlZmluaXRpb25zXG4gICAqIFJlcHJlc2VudGVkIGFzIGBiaWdpbnRgIGluIFR5cGVTY3JpcHQuXG4gICAqIEByZXR1cm5zIEEgbmV3IHtAbGluayBVMjU2QnVpbGRlcn0gaW5zdGFuY2VcbiAgICovXG4gIHUyNTY6ICgpID0+IG5ldyBVMjU2QnVpbGRlcigpLFxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBgRjMyYCB7QGxpbmsgQWxnZWJyYWljVHlwZX0gdG8gYmUgdXNlZCBpbiB0YWJsZSBkZWZpbml0aW9uc1xuICAgKiBSZXByZXNlbnRlZCBhcyBgbnVtYmVyYCBpbiBUeXBlU2NyaXB0LlxuICAgKiBAcmV0dXJucyBBIG5ldyB7QGxpbmsgRjMyQnVpbGRlcn0gaW5zdGFuY2VcbiAgICovXG4gIGYzMjogKCkgPT4gbmV3IEYzMkJ1aWxkZXIoKSxcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgYEY2NGAge0BsaW5rIEFsZ2VicmFpY1R5cGV9IHRvIGJlIHVzZWQgaW4gdGFibGUgZGVmaW5pdGlvbnNcbiAgICogUmVwcmVzZW50ZWQgYXMgYG51bWJlcmAgaW4gVHlwZVNjcmlwdC5cbiAgICogQHJldHVybnMgQSBuZXcge0BsaW5rIEY2NEJ1aWxkZXJ9IGluc3RhbmNlXG4gICAqL1xuICBmNjQ6ICgpID0+IG5ldyBGNjRCdWlsZGVyKCksXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGBQcm9kdWN0YCB7QGxpbmsgQWxnZWJyYWljVHlwZX0gdG8gYmUgdXNlZCBpbiB0YWJsZSBkZWZpbml0aW9ucy4gUHJvZHVjdCB0eXBlcyBpbiBTcGFjZXRpbWVEQlxuICAgKiBhcmUgZXNzZW50aWFsbHkgdGhlIHNhbWUgYXMgb2JqZWN0cyBpbiBKYXZhU2NyaXB0L1R5cGVTY3JpcHQuXG4gICAqIFByb3BlcnRpZXMgb2YgdGhlIG9iamVjdCBtdXN0IGFsc28gYmUge0BsaW5rIFR5cGVCdWlsZGVyfXMuXG4gICAqIFJlcHJlc2VudGVkIGFzIGFuIG9iamVjdCB3aXRoIHNwZWNpZmljIHByb3BlcnRpZXMgaW4gVHlwZVNjcmlwdC5cbiAgICpcbiAgICogQHBhcmFtIG5hbWUgKG9wdGlvbmFsKSBBIGRpc3BsYXkgbmFtZSBmb3IgdGhlIHByb2R1Y3QgdHlwZS4gSWYgb21pdHRlZCwgYW4gYW5vbnltb3VzIHByb2R1Y3QgdHlwZSBpcyBjcmVhdGVkLlxuICAgKiBAcGFyYW0gb2JqIFRoZSBvYmplY3QgZGVmaW5pbmcgdGhlIHByb3BlcnRpZXMgb2YgdGhlIHR5cGUsIHdob3NlIHByb3BlcnR5XG4gICAqIHZhbHVlcyBtdXN0IGJlIHtAbGluayBUeXBlQnVpbGRlcn1zLlxuICAgKiBAcmV0dXJucyBBIG5ldyB7QGxpbmsgUHJvZHVjdEJ1aWxkZXJ9IGluc3RhbmNlLlxuICAgKi9cbiAgb2JqZWN0OiAoKG5hbWVPck9iaiwgbWF5YmVPYmopID0+IHtcbiAgICBpZiAodHlwZW9mIG5hbWVPck9iaiA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgaWYgKCFtYXliZU9iaikge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFxuICAgICAgICAgIFwiV2hlbiBwcm92aWRpbmcgYSBuYW1lLCB5b3UgbXVzdCBhbHNvIHByb3ZpZGUgdGhlIG9iamVjdC5cIlxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBQcm9kdWN0QnVpbGRlcihtYXliZU9iaiwgbmFtZU9yT2JqKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBQcm9kdWN0QnVpbGRlcihuYW1lT3JPYmosIHZvaWQgMCk7XG4gIH0pLFxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBgUm93YCB7QGxpbmsgQWxnZWJyYWljVHlwZX0gdG8gYmUgdXNlZCBpbiB0YWJsZSBkZWZpbml0aW9ucy4gUm93IHR5cGVzIGluIFNwYWNldGltZURCXG4gICAqIGFyZSBzaW1pbGFyIHRvIGBQcm9kdWN0YCB0eXBlcywgYnV0IGFyZSBzcGVjaWZpY2FsbHkgdXNlZCB0byBkZWZpbmUgdGhlIHNjaGVtYSBvZiBhIHRhYmxlIHJvdy5cbiAgICogUHJvcGVydGllcyBvZiB0aGUgb2JqZWN0IG11c3QgYWxzbyBiZSB7QGxpbmsgVHlwZUJ1aWxkZXJ9IG9yIHtAbGluayBDb2x1bW5CdWlsZGVyfXMuXG4gICAqXG4gICAqIFlvdSBjYW4gcmVwcmVzZW50IGEgYFJvd2AgYXMgZWl0aGVyIGEge0BsaW5rIFJvd09ian0gb3IgYW4ge0BsaW5rIFJvd0J1aWxkZXJ9IHR5cGUgd2hlblxuICAgKiBkZWZpbmluZyBhIHRhYmxlIHNjaGVtYS5cbiAgICpcbiAgICogVGhlIHtAbGluayBSb3dCdWlsZGVyfSB0eXBlIGlzIHVzZWZ1bCB3aGVuIHlvdSB3YW50IHRvIGNyZWF0ZSBhIHR5cGUgd2hpY2ggY2FuIGJlIHVzZWQgYW55d2hlcmVcbiAgICogYSB7QGxpbmsgVHlwZUJ1aWxkZXJ9IGlzIGFjY2VwdGVkLCBzdWNoIGFzIGluIG5lc3RlZCBvYmplY3RzIG9yIGFycmF5cywgb3IgYXMgdGhlIGFyZ3VtZW50XG4gICAqIHRvIGEgc2NoZWR1bGVkIGZ1bmN0aW9uLlxuICAgKlxuICAgKiBAcGFyYW0gb2JqIFRoZSBvYmplY3QgZGVmaW5pbmcgdGhlIHByb3BlcnRpZXMgb2YgdGhlIHJvdywgd2hvc2UgcHJvcGVydHlcbiAgICogdmFsdWVzIG11c3QgYmUge0BsaW5rIFR5cGVCdWlsZGVyfXMgb3Ige0BsaW5rIENvbHVtbkJ1aWxkZXJ9cy5cbiAgICogQHJldHVybnMgQSBuZXcge0BsaW5rIFJvd0J1aWxkZXJ9IGluc3RhbmNlXG4gICAqL1xuICByb3c6ICgobmFtZU9yT2JqLCBtYXliZU9iaikgPT4ge1xuICAgIGNvbnN0IFtvYmosIG5hbWVdID0gdHlwZW9mIG5hbWVPck9iaiA9PT0gXCJzdHJpbmdcIiA/IFttYXliZU9iaiwgbmFtZU9yT2JqXSA6IFtuYW1lT3JPYmosIHZvaWQgMF07XG4gICAgcmV0dXJuIG5ldyBSb3dCdWlsZGVyKG9iaiwgbmFtZSk7XG4gIH0pLFxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBgQXJyYXlgIHtAbGluayBBbGdlYnJhaWNUeXBlfSB0byBiZSB1c2VkIGluIHRhYmxlIGRlZmluaXRpb25zLlxuICAgKiBSZXByZXNlbnRlZCBhcyBhbiBhcnJheSBpbiBUeXBlU2NyaXB0LlxuICAgKiBAcGFyYW0gZWxlbWVudCBUaGUgZWxlbWVudCB0eXBlIG9mIHRoZSBhcnJheSwgd2hpY2ggbXVzdCBiZSBhIGBUeXBlQnVpbGRlcmAuXG4gICAqIEByZXR1cm5zIEEgbmV3IHtAbGluayBBcnJheUJ1aWxkZXJ9IGluc3RhbmNlXG4gICAqL1xuICBhcnJheShlKSB7XG4gICAgcmV0dXJuIG5ldyBBcnJheUJ1aWxkZXIoZSk7XG4gIH0sXG4gIGVudW06IGVudW1JbXBsLFxuICAvKipcbiAgICogVGhpcyBpcyBhIHNwZWNpYWwgaGVscGVyIGZ1bmN0aW9uIGZvciBjb252ZW5pZW50bHkgY3JlYXRpbmcgYFByb2R1Y3RgIHR5cGUgY29sdW1ucyB3aXRoIG5vIGZpZWxkcy5cbiAgICpcbiAgICogQHJldHVybnMgQSBuZXcge0BsaW5rIFByb2R1Y3RCdWlsZGVyfSBpbnN0YW5jZSB3aXRoIG5vIGZpZWxkcy5cbiAgICovXG4gIHVuaXQoKSB7XG4gICAgcmV0dXJuIG5ldyBVbml0QnVpbGRlcigpO1xuICB9LFxuICAvKipcbiAgICogQ3JlYXRlcyBhIGxhemlseS1ldmFsdWF0ZWQge0BsaW5rIFR5cGVCdWlsZGVyfS4gVGhpcyBpcyB1c2VmdWwgZm9yIGNyZWF0aW5nXG4gICAqIHJlY3Vyc2l2ZSB0eXBlcywgc3VjaCBhcyBhIHRyZWUgb3IgbGlua2VkIGxpc3QuXG4gICAqIEBwYXJhbSB0aHVuayBBIGZ1bmN0aW9uIHRoYXQgcmV0dXJucyBhIHtAbGluayBUeXBlQnVpbGRlcn0uXG4gICAqIEByZXR1cm5zIEEgcHJveHkge0BsaW5rIFR5cGVCdWlsZGVyfSB0aGF0IGV2YWx1YXRlcyB0aGUgdGh1bmsgb24gZmlyc3QgYWNjZXNzLlxuICAgKi9cbiAgbGF6eSh0aHVuaykge1xuICAgIGxldCBjYWNoZWQgPSBudWxsO1xuICAgIGNvbnN0IGdldCA9ICgpID0+IGNhY2hlZCA/Pz0gdGh1bmsoKTtcbiAgICBjb25zdCBwcm94eSA9IG5ldyBQcm94eSh7fSwge1xuICAgICAgZ2V0KF90LCBwcm9wLCByZWN2KSB7XG4gICAgICAgIGNvbnN0IHRhcmdldCA9IGdldCgpO1xuICAgICAgICBjb25zdCB2YWwgPSBSZWZsZWN0LmdldCh0YXJnZXQsIHByb3AsIHJlY3YpO1xuICAgICAgICByZXR1cm4gdHlwZW9mIHZhbCA9PT0gXCJmdW5jdGlvblwiID8gdmFsLmJpbmQodGFyZ2V0KSA6IHZhbDtcbiAgICAgIH0sXG4gICAgICBzZXQoX3QsIHByb3AsIHZhbHVlLCByZWN2KSB7XG4gICAgICAgIHJldHVybiBSZWZsZWN0LnNldChnZXQoKSwgcHJvcCwgdmFsdWUsIHJlY3YpO1xuICAgICAgfSxcbiAgICAgIGhhcyhfdCwgcHJvcCkge1xuICAgICAgICByZXR1cm4gcHJvcCBpbiBnZXQoKTtcbiAgICAgIH0sXG4gICAgICBvd25LZXlzKCkge1xuICAgICAgICByZXR1cm4gUmVmbGVjdC5vd25LZXlzKGdldCgpKTtcbiAgICAgIH0sXG4gICAgICBnZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoX3QsIHByb3ApIHtcbiAgICAgICAgcmV0dXJuIE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoZ2V0KCksIHByb3ApO1xuICAgICAgfSxcbiAgICAgIGdldFByb3RvdHlwZU9mKCkge1xuICAgICAgICByZXR1cm4gT2JqZWN0LmdldFByb3RvdHlwZU9mKGdldCgpKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gcHJveHk7XG4gIH0sXG4gIC8qKlxuICAgKiBUaGlzIGlzIGEgc3BlY2lhbCBoZWxwZXIgZnVuY3Rpb24gZm9yIGNvbnZlbmllbnRseSBjcmVhdGluZyB7QGxpbmsgU2NoZWR1bGVBdH0gdHlwZSBjb2x1bW5zLlxuICAgKiBAcmV0dXJucyBBIG5ldyBDb2x1bW5CdWlsZGVyIGluc3RhbmNlIHdpdGggdGhlIHtAbGluayBTY2hlZHVsZUF0fSB0eXBlLlxuICAgKi9cbiAgc2NoZWR1bGVBdDogKCkgPT4ge1xuICAgIHJldHVybiBuZXcgU2NoZWR1bGVBdEJ1aWxkZXIoKTtcbiAgfSxcbiAgLyoqXG4gICAqIFRoaXMgaXMgYSBjb252ZW5pZW5jZSBtZXRob2QgZm9yIGNyZWF0aW5nIGEgY29sdW1uIHdpdGggdGhlIHtAbGluayBPcHRpb259IHR5cGUuXG4gICAqIFlvdSBjYW4gY3JlYXRlIGEgY29sdW1uIG9mIHRoZSBzYW1lIHR5cGUgYnkgY29uc3RydWN0aW5nIGFuIGVudW0gd2l0aCBhIGBzb21lYCBhbmQgYG5vbmVgIHZhcmlhbnQuXG4gICAqIEBwYXJhbSB2YWx1ZSBUaGUgdHlwZSBvZiB0aGUgdmFsdWUgY29udGFpbmVkIGluIHRoZSBgc29tZWAgdmFyaWFudCBvZiB0aGUgYE9wdGlvbmAuXG4gICAqIEByZXR1cm5zIEEgbmV3IHtAbGluayBPcHRpb25CdWlsZGVyfSBpbnN0YW5jZSB3aXRoIHRoZSB7QGxpbmsgT3B0aW9ufSB0eXBlLlxuICAgKi9cbiAgb3B0aW9uKHZhbHVlKSB7XG4gICAgcmV0dXJuIG5ldyBPcHRpb25CdWlsZGVyKHZhbHVlKTtcbiAgfSxcbiAgLyoqXG4gICAqIFRoaXMgaXMgYSBjb252ZW5pZW5jZSBtZXRob2QgZm9yIGNyZWF0aW5nIGEgY29sdW1uIHdpdGggdGhlIHtAbGluayBSZXN1bHR9IHR5cGUuXG4gICAqIFlvdSBjYW4gY3JlYXRlIGEgY29sdW1uIG9mIHRoZSBzYW1lIHR5cGUgYnkgY29uc3RydWN0aW5nIGFuIGVudW0gd2l0aCBhbiBgb2tgIGFuZCBgZXJyYCB2YXJpYW50LlxuICAgKiBAcGFyYW0gb2sgVGhlIHR5cGUgb2YgdGhlIHZhbHVlIGNvbnRhaW5lZCBpbiB0aGUgYG9rYCB2YXJpYW50IG9mIHRoZSBgUmVzdWx0YC5cbiAgICogQHBhcmFtIGVyciBUaGUgdHlwZSBvZiB0aGUgdmFsdWUgY29udGFpbmVkIGluIHRoZSBgZXJyYCB2YXJpYW50IG9mIHRoZSBgUmVzdWx0YC5cbiAgICogQHJldHVybnMgQSBuZXcge0BsaW5rIFJlc3VsdEJ1aWxkZXJ9IGluc3RhbmNlIHdpdGggdGhlIHtAbGluayBSZXN1bHR9IHR5cGUuXG4gICAqL1xuICByZXN1bHQob2ssIGVycikge1xuICAgIHJldHVybiBuZXcgUmVzdWx0QnVpbGRlcihvaywgZXJyKTtcbiAgfSxcbiAgLyoqXG4gICAqIFRoaXMgaXMgYSBjb252ZW5pZW5jZSBtZXRob2QgZm9yIGNyZWF0aW5nIGEgY29sdW1uIHdpdGggdGhlIHtAbGluayBJZGVudGl0eX0gdHlwZS5cbiAgICogWW91IGNhbiBjcmVhdGUgYSBjb2x1bW4gb2YgdGhlIHNhbWUgdHlwZSBieSBjb25zdHJ1Y3RpbmcgYW4gYG9iamVjdGAgd2l0aCBhIHNpbmdsZSBgX19pZGVudGl0eV9fYCBlbGVtZW50LlxuICAgKiBAcmV0dXJucyBBIG5ldyB7QGxpbmsgVHlwZUJ1aWxkZXJ9IGluc3RhbmNlIHdpdGggdGhlIHtAbGluayBJZGVudGl0eX0gdHlwZS5cbiAgICovXG4gIGlkZW50aXR5OiAoKSA9PiB7XG4gICAgcmV0dXJuIG5ldyBJZGVudGl0eUJ1aWxkZXIoKTtcbiAgfSxcbiAgLyoqXG4gICAqIFRoaXMgaXMgYSBjb252ZW5pZW5jZSBtZXRob2QgZm9yIGNyZWF0aW5nIGEgY29sdW1uIHdpdGggdGhlIHtAbGluayBDb25uZWN0aW9uSWR9IHR5cGUuXG4gICAqIFlvdSBjYW4gY3JlYXRlIGEgY29sdW1uIG9mIHRoZSBzYW1lIHR5cGUgYnkgY29uc3RydWN0aW5nIGFuIGBvYmplY3RgIHdpdGggYSBzaW5nbGUgYF9fY29ubmVjdGlvbl9pZF9fYCBlbGVtZW50LlxuICAgKiBAcmV0dXJucyBBIG5ldyB7QGxpbmsgVHlwZUJ1aWxkZXJ9IGluc3RhbmNlIHdpdGggdGhlIHtAbGluayBDb25uZWN0aW9uSWR9IHR5cGUuXG4gICAqL1xuICBjb25uZWN0aW9uSWQ6ICgpID0+IHtcbiAgICByZXR1cm4gbmV3IENvbm5lY3Rpb25JZEJ1aWxkZXIoKTtcbiAgfSxcbiAgLyoqXG4gICAqIFRoaXMgaXMgYSBjb252ZW5pZW5jZSBtZXRob2QgZm9yIGNyZWF0aW5nIGEgY29sdW1uIHdpdGggdGhlIHtAbGluayBUaW1lc3RhbXB9IHR5cGUuXG4gICAqIFlvdSBjYW4gY3JlYXRlIGEgY29sdW1uIG9mIHRoZSBzYW1lIHR5cGUgYnkgY29uc3RydWN0aW5nIGFuIGBvYmplY3RgIHdpdGggYSBzaW5nbGUgYF9fdGltZXN0YW1wX21pY3Jvc19zaW5jZV91bml4X2Vwb2NoX19gIGVsZW1lbnQuXG4gICAqIEByZXR1cm5zIEEgbmV3IHtAbGluayBUeXBlQnVpbGRlcn0gaW5zdGFuY2Ugd2l0aCB0aGUge0BsaW5rIFRpbWVzdGFtcH0gdHlwZS5cbiAgICovXG4gIHRpbWVzdGFtcDogKCkgPT4ge1xuICAgIHJldHVybiBuZXcgVGltZXN0YW1wQnVpbGRlcigpO1xuICB9LFxuICAvKipcbiAgICogVGhpcyBpcyBhIGNvbnZlbmllbmNlIG1ldGhvZCBmb3IgY3JlYXRpbmcgYSBjb2x1bW4gd2l0aCB0aGUge0BsaW5rIFRpbWVEdXJhdGlvbn0gdHlwZS5cbiAgICogWW91IGNhbiBjcmVhdGUgYSBjb2x1bW4gb2YgdGhlIHNhbWUgdHlwZSBieSBjb25zdHJ1Y3RpbmcgYW4gYG9iamVjdGAgd2l0aCBhIHNpbmdsZSBgX190aW1lX2R1cmF0aW9uX21pY3Jvc19fYCBlbGVtZW50LlxuICAgKiBAcmV0dXJucyBBIG5ldyB7QGxpbmsgVHlwZUJ1aWxkZXJ9IGluc3RhbmNlIHdpdGggdGhlIHtAbGluayBUaW1lRHVyYXRpb259IHR5cGUuXG4gICAqL1xuICB0aW1lRHVyYXRpb246ICgpID0+IHtcbiAgICByZXR1cm4gbmV3IFRpbWVEdXJhdGlvbkJ1aWxkZXIoKTtcbiAgfSxcbiAgLyoqXG4gICAqIFRoaXMgaXMgYSBjb252ZW5pZW5jZSBtZXRob2QgZm9yIGNyZWF0aW5nIGEgY29sdW1uIHdpdGggdGhlIHtAbGluayBVdWlkfSB0eXBlLlxuICAgKiBZb3UgY2FuIGNyZWF0ZSBhIGNvbHVtbiBvZiB0aGUgc2FtZSB0eXBlIGJ5IGNvbnN0cnVjdGluZyBhbiBgb2JqZWN0YCB3aXRoIGEgc2luZ2xlIGBfX3V1aWRfX2AgZWxlbWVudC5cbiAgICogQHJldHVybnMgQSBuZXcge0BsaW5rIFR5cGVCdWlsZGVyfSBpbnN0YW5jZSB3aXRoIHRoZSB7QGxpbmsgVXVpZH0gdHlwZS5cbiAgICovXG4gIHV1aWQ6ICgpID0+IHtcbiAgICByZXR1cm4gbmV3IFV1aWRCdWlsZGVyKCk7XG4gIH0sXG4gIC8qKlxuICAgKiBUaGlzIGlzIGEgY29udmVuaWVuY2UgbWV0aG9kIGZvciBjcmVhdGluZyBhIGNvbHVtbiB3aXRoIHRoZSBgQnl0ZUFycmF5YCB0eXBlLlxuICAgKiBZb3UgY2FuIGNyZWF0ZSBhIGNvbHVtbiBvZiB0aGUgc2FtZSB0eXBlIGJ5IGNvbnN0cnVjdGluZyBhbiBgYXJyYXlgIG9mIGB1OGAuXG4gICAqIFRoZSBUeXBlU2NyaXB0IHJlcHJlc2VudGF0aW9uIGlzIHtAbGluayBVaW50OEFycmF5fS5cbiAgICogQHJldHVybnMgQSBuZXcge0BsaW5rIEJ5dGVBcnJheUJ1aWxkZXJ9IGluc3RhbmNlIHdpdGggdGhlIGBCeXRlQXJyYXlgIHR5cGUuXG4gICAqL1xuICBieXRlQXJyYXk6ICgpID0+IHtcbiAgICByZXR1cm4gbmV3IEJ5dGVBcnJheUJ1aWxkZXIoKTtcbiAgfVxufTtcblxuLy8gc3JjL2xpYi9hdXRvZ2VuL3R5cGVzLnRzXG52YXIgQWxnZWJyYWljVHlwZTIgPSB0LmVudW0oXCJBbGdlYnJhaWNUeXBlXCIsIHtcbiAgUmVmOiB0LnUzMigpLFxuICBnZXQgU3VtKCkge1xuICAgIHJldHVybiBTdW1UeXBlMjtcbiAgfSxcbiAgZ2V0IFByb2R1Y3QoKSB7XG4gICAgcmV0dXJuIFByb2R1Y3RUeXBlMjtcbiAgfSxcbiAgZ2V0IEFycmF5KCkge1xuICAgIHJldHVybiBBbGdlYnJhaWNUeXBlMjtcbiAgfSxcbiAgU3RyaW5nOiB0LnVuaXQoKSxcbiAgQm9vbDogdC51bml0KCksXG4gIEk4OiB0LnVuaXQoKSxcbiAgVTg6IHQudW5pdCgpLFxuICBJMTY6IHQudW5pdCgpLFxuICBVMTY6IHQudW5pdCgpLFxuICBJMzI6IHQudW5pdCgpLFxuICBVMzI6IHQudW5pdCgpLFxuICBJNjQ6IHQudW5pdCgpLFxuICBVNjQ6IHQudW5pdCgpLFxuICBJMTI4OiB0LnVuaXQoKSxcbiAgVTEyODogdC51bml0KCksXG4gIEkyNTY6IHQudW5pdCgpLFxuICBVMjU2OiB0LnVuaXQoKSxcbiAgRjMyOiB0LnVuaXQoKSxcbiAgRjY0OiB0LnVuaXQoKVxufSk7XG52YXIgQ2FzZUNvbnZlcnNpb25Qb2xpY3kgPSB0LmVudW0oXCJDYXNlQ29udmVyc2lvblBvbGljeVwiLCB7XG4gIE5vbmU6IHQudW5pdCgpLFxuICBTbmFrZUNhc2U6IHQudW5pdCgpXG59KTtcbnZhciBFeHBsaWNpdE5hbWVFbnRyeSA9IHQuZW51bShcIkV4cGxpY2l0TmFtZUVudHJ5XCIsIHtcbiAgZ2V0IFRhYmxlKCkge1xuICAgIHJldHVybiBOYW1lTWFwcGluZztcbiAgfSxcbiAgZ2V0IEZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBOYW1lTWFwcGluZztcbiAgfSxcbiAgZ2V0IEluZGV4KCkge1xuICAgIHJldHVybiBOYW1lTWFwcGluZztcbiAgfVxufSk7XG52YXIgRXhwbGljaXROYW1lcyA9IHQub2JqZWN0KFwiRXhwbGljaXROYW1lc1wiLCB7XG4gIGdldCBlbnRyaWVzKCkge1xuICAgIHJldHVybiB0LmFycmF5KEV4cGxpY2l0TmFtZUVudHJ5KTtcbiAgfVxufSk7XG52YXIgRnVuY3Rpb25WaXNpYmlsaXR5ID0gdC5lbnVtKFwiRnVuY3Rpb25WaXNpYmlsaXR5XCIsIHtcbiAgUHJpdmF0ZTogdC51bml0KCksXG4gIENsaWVudENhbGxhYmxlOiB0LnVuaXQoKVxufSk7XG52YXIgSHR0cEhlYWRlclBhaXIgPSB0Lm9iamVjdChcIkh0dHBIZWFkZXJQYWlyXCIsIHtcbiAgbmFtZTogdC5zdHJpbmcoKSxcbiAgdmFsdWU6IHQuYnl0ZUFycmF5KClcbn0pO1xudmFyIEh0dHBIZWFkZXJzID0gdC5vYmplY3QoXCJIdHRwSGVhZGVyc1wiLCB7XG4gIGdldCBlbnRyaWVzKCkge1xuICAgIHJldHVybiB0LmFycmF5KEh0dHBIZWFkZXJQYWlyKTtcbiAgfVxufSk7XG52YXIgSHR0cE1ldGhvZCA9IHQuZW51bShcIkh0dHBNZXRob2RcIiwge1xuICBHZXQ6IHQudW5pdCgpLFxuICBIZWFkOiB0LnVuaXQoKSxcbiAgUG9zdDogdC51bml0KCksXG4gIFB1dDogdC51bml0KCksXG4gIERlbGV0ZTogdC51bml0KCksXG4gIENvbm5lY3Q6IHQudW5pdCgpLFxuICBPcHRpb25zOiB0LnVuaXQoKSxcbiAgVHJhY2U6IHQudW5pdCgpLFxuICBQYXRjaDogdC51bml0KCksXG4gIEV4dGVuc2lvbjogdC5zdHJpbmcoKVxufSk7XG52YXIgSHR0cFJlcXVlc3QgPSB0Lm9iamVjdChcIkh0dHBSZXF1ZXN0XCIsIHtcbiAgZ2V0IG1ldGhvZCgpIHtcbiAgICByZXR1cm4gSHR0cE1ldGhvZDtcbiAgfSxcbiAgZ2V0IGhlYWRlcnMoKSB7XG4gICAgcmV0dXJuIEh0dHBIZWFkZXJzO1xuICB9LFxuICB0aW1lb3V0OiB0Lm9wdGlvbih0LnRpbWVEdXJhdGlvbigpKSxcbiAgdXJpOiB0LnN0cmluZygpLFxuICBnZXQgdmVyc2lvbigpIHtcbiAgICByZXR1cm4gSHR0cFZlcnNpb247XG4gIH1cbn0pO1xudmFyIEh0dHBSZXNwb25zZSA9IHQub2JqZWN0KFwiSHR0cFJlc3BvbnNlXCIsIHtcbiAgZ2V0IGhlYWRlcnMoKSB7XG4gICAgcmV0dXJuIEh0dHBIZWFkZXJzO1xuICB9LFxuICBnZXQgdmVyc2lvbigpIHtcbiAgICByZXR1cm4gSHR0cFZlcnNpb247XG4gIH0sXG4gIGNvZGU6IHQudTE2KClcbn0pO1xudmFyIEh0dHBWZXJzaW9uID0gdC5lbnVtKFwiSHR0cFZlcnNpb25cIiwge1xuICBIdHRwMDk6IHQudW5pdCgpLFxuICBIdHRwMTA6IHQudW5pdCgpLFxuICBIdHRwMTE6IHQudW5pdCgpLFxuICBIdHRwMjogdC51bml0KCksXG4gIEh0dHAzOiB0LnVuaXQoKVxufSk7XG52YXIgSW5kZXhUeXBlID0gdC5lbnVtKFwiSW5kZXhUeXBlXCIsIHtcbiAgQlRyZWU6IHQudW5pdCgpLFxuICBIYXNoOiB0LnVuaXQoKVxufSk7XG52YXIgTGlmZWN5Y2xlID0gdC5lbnVtKFwiTGlmZWN5Y2xlXCIsIHtcbiAgSW5pdDogdC51bml0KCksXG4gIE9uQ29ubmVjdDogdC51bml0KCksXG4gIE9uRGlzY29ubmVjdDogdC51bml0KClcbn0pO1xudmFyIE1ldGhvZE9yQW55ID0gdC5lbnVtKFwiTWV0aG9kT3JBbnlcIiwge1xuICBBbnk6IHQudW5pdCgpLFxuICBnZXQgTWV0aG9kKCkge1xuICAgIHJldHVybiBIdHRwTWV0aG9kO1xuICB9XG59KTtcbnZhciBNaXNjTW9kdWxlRXhwb3J0ID0gdC5lbnVtKFwiTWlzY01vZHVsZUV4cG9ydFwiLCB7XG4gIGdldCBUeXBlQWxpYXMoKSB7XG4gICAgcmV0dXJuIFR5cGVBbGlhcztcbiAgfVxufSk7XG52YXIgTmFtZU1hcHBpbmcgPSB0Lm9iamVjdChcIk5hbWVNYXBwaW5nXCIsIHtcbiAgc291cmNlTmFtZTogdC5zdHJpbmcoKSxcbiAgY2Fub25pY2FsTmFtZTogdC5zdHJpbmcoKVxufSk7XG52YXIgUHJvZHVjdFR5cGUyID0gdC5vYmplY3QoXCJQcm9kdWN0VHlwZVwiLCB7XG4gIGdldCBlbGVtZW50cygpIHtcbiAgICByZXR1cm4gdC5hcnJheShQcm9kdWN0VHlwZUVsZW1lbnQpO1xuICB9XG59KTtcbnZhciBQcm9kdWN0VHlwZUVsZW1lbnQgPSB0Lm9iamVjdChcIlByb2R1Y3RUeXBlRWxlbWVudFwiLCB7XG4gIG5hbWU6IHQub3B0aW9uKHQuc3RyaW5nKCkpLFxuICBnZXQgYWxnZWJyYWljVHlwZSgpIHtcbiAgICByZXR1cm4gQWxnZWJyYWljVHlwZTI7XG4gIH1cbn0pO1xudmFyIFJhd0NvbHVtbkRlZlY4ID0gdC5vYmplY3QoXCJSYXdDb2x1bW5EZWZWOFwiLCB7XG4gIGNvbE5hbWU6IHQuc3RyaW5nKCksXG4gIGdldCBjb2xUeXBlKCkge1xuICAgIHJldHVybiBBbGdlYnJhaWNUeXBlMjtcbiAgfVxufSk7XG52YXIgUmF3Q29sdW1uRGVmYXVsdFZhbHVlVjEwID0gdC5vYmplY3QoXCJSYXdDb2x1bW5EZWZhdWx0VmFsdWVWMTBcIiwge1xuICBjb2xJZDogdC51MTYoKSxcbiAgdmFsdWU6IHQuYnl0ZUFycmF5KClcbn0pO1xudmFyIFJhd0NvbHVtbkRlZmF1bHRWYWx1ZVY5ID0gdC5vYmplY3QoXCJSYXdDb2x1bW5EZWZhdWx0VmFsdWVWOVwiLCB7XG4gIHRhYmxlOiB0LnN0cmluZygpLFxuICBjb2xJZDogdC51MTYoKSxcbiAgdmFsdWU6IHQuYnl0ZUFycmF5KClcbn0pO1xudmFyIFJhd0NvbnN0cmFpbnREYXRhVjkgPSB0LmVudW0oXCJSYXdDb25zdHJhaW50RGF0YVY5XCIsIHtcbiAgZ2V0IFVuaXF1ZSgpIHtcbiAgICByZXR1cm4gUmF3VW5pcXVlQ29uc3RyYWludERhdGFWOTtcbiAgfVxufSk7XG52YXIgUmF3Q29uc3RyYWludERlZlYxMCA9IHQub2JqZWN0KFwiUmF3Q29uc3RyYWludERlZlYxMFwiLCB7XG4gIHNvdXJjZU5hbWU6IHQub3B0aW9uKHQuc3RyaW5nKCkpLFxuICBnZXQgZGF0YSgpIHtcbiAgICByZXR1cm4gUmF3Q29uc3RyYWludERhdGFWOTtcbiAgfVxufSk7XG52YXIgUmF3Q29uc3RyYWludERlZlY4ID0gdC5vYmplY3QoXCJSYXdDb25zdHJhaW50RGVmVjhcIiwge1xuICBjb25zdHJhaW50TmFtZTogdC5zdHJpbmcoKSxcbiAgY29uc3RyYWludHM6IHQudTgoKSxcbiAgY29sdW1uczogdC5hcnJheSh0LnUxNigpKVxufSk7XG52YXIgUmF3Q29uc3RyYWludERlZlY5ID0gdC5vYmplY3QoXCJSYXdDb25zdHJhaW50RGVmVjlcIiwge1xuICBuYW1lOiB0Lm9wdGlvbih0LnN0cmluZygpKSxcbiAgZ2V0IGRhdGEoKSB7XG4gICAgcmV0dXJuIFJhd0NvbnN0cmFpbnREYXRhVjk7XG4gIH1cbn0pO1xudmFyIFJhd0h0dHBIYW5kbGVyRGVmVjEwID0gdC5vYmplY3QoXCJSYXdIdHRwSGFuZGxlckRlZlYxMFwiLCB7XG4gIHNvdXJjZU5hbWU6IHQuc3RyaW5nKClcbn0pO1xudmFyIFJhd0h0dHBSb3V0ZURlZlYxMCA9IHQub2JqZWN0KFwiUmF3SHR0cFJvdXRlRGVmVjEwXCIsIHtcbiAgaGFuZGxlckZ1bmN0aW9uOiB0LnN0cmluZygpLFxuICBnZXQgbWV0aG9kKCkge1xuICAgIHJldHVybiBNZXRob2RPckFueTtcbiAgfSxcbiAgcGF0aDogdC5zdHJpbmcoKVxufSk7XG52YXIgUmF3SW5kZXhBbGdvcml0aG0gPSB0LmVudW0oXCJSYXdJbmRleEFsZ29yaXRobVwiLCB7XG4gIEJUcmVlOiB0LmFycmF5KHQudTE2KCkpLFxuICBIYXNoOiB0LmFycmF5KHQudTE2KCkpLFxuICBEaXJlY3Q6IHQudTE2KClcbn0pO1xudmFyIFJhd0luZGV4RGVmVjEwID0gdC5vYmplY3QoXCJSYXdJbmRleERlZlYxMFwiLCB7XG4gIHNvdXJjZU5hbWU6IHQub3B0aW9uKHQuc3RyaW5nKCkpLFxuICBhY2Nlc3Nvck5hbWU6IHQub3B0aW9uKHQuc3RyaW5nKCkpLFxuICBnZXQgYWxnb3JpdGhtKCkge1xuICAgIHJldHVybiBSYXdJbmRleEFsZ29yaXRobTtcbiAgfVxufSk7XG52YXIgUmF3SW5kZXhEZWZWOCA9IHQub2JqZWN0KFwiUmF3SW5kZXhEZWZWOFwiLCB7XG4gIGluZGV4TmFtZTogdC5zdHJpbmcoKSxcbiAgaXNVbmlxdWU6IHQuYm9vbCgpLFxuICBnZXQgaW5kZXhUeXBlKCkge1xuICAgIHJldHVybiBJbmRleFR5cGU7XG4gIH0sXG4gIGNvbHVtbnM6IHQuYXJyYXkodC51MTYoKSlcbn0pO1xudmFyIFJhd0luZGV4RGVmVjkgPSB0Lm9iamVjdChcIlJhd0luZGV4RGVmVjlcIiwge1xuICBuYW1lOiB0Lm9wdGlvbih0LnN0cmluZygpKSxcbiAgYWNjZXNzb3JOYW1lOiB0Lm9wdGlvbih0LnN0cmluZygpKSxcbiAgZ2V0IGFsZ29yaXRobSgpIHtcbiAgICByZXR1cm4gUmF3SW5kZXhBbGdvcml0aG07XG4gIH1cbn0pO1xudmFyIFJhd0xpZmVDeWNsZVJlZHVjZXJEZWZWMTAgPSB0Lm9iamVjdChcbiAgXCJSYXdMaWZlQ3ljbGVSZWR1Y2VyRGVmVjEwXCIsXG4gIHtcbiAgICBnZXQgbGlmZWN5Y2xlU3BlYygpIHtcbiAgICAgIHJldHVybiBMaWZlY3ljbGU7XG4gICAgfSxcbiAgICBmdW5jdGlvbk5hbWU6IHQuc3RyaW5nKClcbiAgfVxuKTtcbnZhciBSYXdNaXNjTW9kdWxlRXhwb3J0VjkgPSB0LmVudW0oXCJSYXdNaXNjTW9kdWxlRXhwb3J0VjlcIiwge1xuICBnZXQgQ29sdW1uRGVmYXVsdFZhbHVlKCkge1xuICAgIHJldHVybiBSYXdDb2x1bW5EZWZhdWx0VmFsdWVWOTtcbiAgfSxcbiAgZ2V0IFByb2NlZHVyZSgpIHtcbiAgICByZXR1cm4gUmF3UHJvY2VkdXJlRGVmVjk7XG4gIH0sXG4gIGdldCBWaWV3KCkge1xuICAgIHJldHVybiBSYXdWaWV3RGVmVjk7XG4gIH1cbn0pO1xudmFyIFJhd01vZHVsZURlZiA9IHQuZW51bShcIlJhd01vZHVsZURlZlwiLCB7XG4gIGdldCBWOEJhY2tDb21wYXQoKSB7XG4gICAgcmV0dXJuIFJhd01vZHVsZURlZlY4O1xuICB9LFxuICBnZXQgVjkoKSB7XG4gICAgcmV0dXJuIFJhd01vZHVsZURlZlY5O1xuICB9LFxuICBnZXQgVjEwKCkge1xuICAgIHJldHVybiBSYXdNb2R1bGVEZWZWMTA7XG4gIH1cbn0pO1xudmFyIFJhd01vZHVsZURlZlYxMCA9IHQub2JqZWN0KFwiUmF3TW9kdWxlRGVmVjEwXCIsIHtcbiAgZ2V0IHNlY3Rpb25zKCkge1xuICAgIHJldHVybiB0LmFycmF5KFJhd01vZHVsZURlZlYxMFNlY3Rpb24pO1xuICB9XG59KTtcbnZhciBSYXdNb2R1bGVEZWZWMTBTZWN0aW9uID0gdC5lbnVtKFwiUmF3TW9kdWxlRGVmVjEwU2VjdGlvblwiLCB7XG4gIGdldCBUeXBlc3BhY2UoKSB7XG4gICAgcmV0dXJuIFR5cGVzcGFjZTtcbiAgfSxcbiAgZ2V0IFR5cGVzKCkge1xuICAgIHJldHVybiB0LmFycmF5KFJhd1R5cGVEZWZWMTApO1xuICB9LFxuICBnZXQgVGFibGVzKCkge1xuICAgIHJldHVybiB0LmFycmF5KFJhd1RhYmxlRGVmVjEwKTtcbiAgfSxcbiAgZ2V0IFJlZHVjZXJzKCkge1xuICAgIHJldHVybiB0LmFycmF5KFJhd1JlZHVjZXJEZWZWMTApO1xuICB9LFxuICBnZXQgUHJvY2VkdXJlcygpIHtcbiAgICByZXR1cm4gdC5hcnJheShSYXdQcm9jZWR1cmVEZWZWMTApO1xuICB9LFxuICBnZXQgVmlld3MoKSB7XG4gICAgcmV0dXJuIHQuYXJyYXkoUmF3Vmlld0RlZlYxMCk7XG4gIH0sXG4gIGdldCBTY2hlZHVsZXMoKSB7XG4gICAgcmV0dXJuIHQuYXJyYXkoUmF3U2NoZWR1bGVEZWZWMTApO1xuICB9LFxuICBnZXQgTGlmZUN5Y2xlUmVkdWNlcnMoKSB7XG4gICAgcmV0dXJuIHQuYXJyYXkoUmF3TGlmZUN5Y2xlUmVkdWNlckRlZlYxMCk7XG4gIH0sXG4gIGdldCBSb3dMZXZlbFNlY3VyaXR5KCkge1xuICAgIHJldHVybiB0LmFycmF5KFJhd1Jvd0xldmVsU2VjdXJpdHlEZWZWOSk7XG4gIH0sXG4gIGdldCBDYXNlQ29udmVyc2lvblBvbGljeSgpIHtcbiAgICByZXR1cm4gQ2FzZUNvbnZlcnNpb25Qb2xpY3k7XG4gIH0sXG4gIGdldCBFeHBsaWNpdE5hbWVzKCkge1xuICAgIHJldHVybiBFeHBsaWNpdE5hbWVzO1xuICB9LFxuICBnZXQgSHR0cEhhbmRsZXJzKCkge1xuICAgIHJldHVybiB0LmFycmF5KFJhd0h0dHBIYW5kbGVyRGVmVjEwKTtcbiAgfSxcbiAgZ2V0IEh0dHBSb3V0ZXMoKSB7XG4gICAgcmV0dXJuIHQuYXJyYXkoUmF3SHR0cFJvdXRlRGVmVjEwKTtcbiAgfSxcbiAgZ2V0IFZpZXdQcmltYXJ5S2V5cygpIHtcbiAgICByZXR1cm4gdC5hcnJheShSYXdWaWV3UHJpbWFyeUtleURlZlYxMCk7XG4gIH1cbn0pO1xudmFyIFJhd01vZHVsZURlZlY4ID0gdC5vYmplY3QoXCJSYXdNb2R1bGVEZWZWOFwiLCB7XG4gIGdldCB0eXBlc3BhY2UoKSB7XG4gICAgcmV0dXJuIFR5cGVzcGFjZTtcbiAgfSxcbiAgZ2V0IHRhYmxlcygpIHtcbiAgICByZXR1cm4gdC5hcnJheShUYWJsZURlc2MpO1xuICB9LFxuICBnZXQgcmVkdWNlcnMoKSB7XG4gICAgcmV0dXJuIHQuYXJyYXkoUmVkdWNlckRlZik7XG4gIH0sXG4gIGdldCBtaXNjRXhwb3J0cygpIHtcbiAgICByZXR1cm4gdC5hcnJheShNaXNjTW9kdWxlRXhwb3J0KTtcbiAgfVxufSk7XG52YXIgUmF3TW9kdWxlRGVmVjkgPSB0Lm9iamVjdChcIlJhd01vZHVsZURlZlY5XCIsIHtcbiAgZ2V0IHR5cGVzcGFjZSgpIHtcbiAgICByZXR1cm4gVHlwZXNwYWNlO1xuICB9LFxuICBnZXQgdGFibGVzKCkge1xuICAgIHJldHVybiB0LmFycmF5KFJhd1RhYmxlRGVmVjkpO1xuICB9LFxuICBnZXQgcmVkdWNlcnMoKSB7XG4gICAgcmV0dXJuIHQuYXJyYXkoUmF3UmVkdWNlckRlZlY5KTtcbiAgfSxcbiAgZ2V0IHR5cGVzKCkge1xuICAgIHJldHVybiB0LmFycmF5KFJhd1R5cGVEZWZWOSk7XG4gIH0sXG4gIGdldCBtaXNjRXhwb3J0cygpIHtcbiAgICByZXR1cm4gdC5hcnJheShSYXdNaXNjTW9kdWxlRXhwb3J0VjkpO1xuICB9LFxuICBnZXQgcm93TGV2ZWxTZWN1cml0eSgpIHtcbiAgICByZXR1cm4gdC5hcnJheShSYXdSb3dMZXZlbFNlY3VyaXR5RGVmVjkpO1xuICB9XG59KTtcbnZhciBSYXdQcm9jZWR1cmVEZWZWMTAgPSB0Lm9iamVjdChcIlJhd1Byb2NlZHVyZURlZlYxMFwiLCB7XG4gIHNvdXJjZU5hbWU6IHQuc3RyaW5nKCksXG4gIGdldCBwYXJhbXMoKSB7XG4gICAgcmV0dXJuIFByb2R1Y3RUeXBlMjtcbiAgfSxcbiAgZ2V0IHJldHVyblR5cGUoKSB7XG4gICAgcmV0dXJuIEFsZ2VicmFpY1R5cGUyO1xuICB9LFxuICBnZXQgdmlzaWJpbGl0eSgpIHtcbiAgICByZXR1cm4gRnVuY3Rpb25WaXNpYmlsaXR5O1xuICB9XG59KTtcbnZhciBSYXdQcm9jZWR1cmVEZWZWOSA9IHQub2JqZWN0KFwiUmF3UHJvY2VkdXJlRGVmVjlcIiwge1xuICBuYW1lOiB0LnN0cmluZygpLFxuICBnZXQgcGFyYW1zKCkge1xuICAgIHJldHVybiBQcm9kdWN0VHlwZTI7XG4gIH0sXG4gIGdldCByZXR1cm5UeXBlKCkge1xuICAgIHJldHVybiBBbGdlYnJhaWNUeXBlMjtcbiAgfVxufSk7XG52YXIgUmF3UmVkdWNlckRlZlYxMCA9IHQub2JqZWN0KFwiUmF3UmVkdWNlckRlZlYxMFwiLCB7XG4gIHNvdXJjZU5hbWU6IHQuc3RyaW5nKCksXG4gIGdldCBwYXJhbXMoKSB7XG4gICAgcmV0dXJuIFByb2R1Y3RUeXBlMjtcbiAgfSxcbiAgZ2V0IHZpc2liaWxpdHkoKSB7XG4gICAgcmV0dXJuIEZ1bmN0aW9uVmlzaWJpbGl0eTtcbiAgfSxcbiAgZ2V0IG9rUmV0dXJuVHlwZSgpIHtcbiAgICByZXR1cm4gQWxnZWJyYWljVHlwZTI7XG4gIH0sXG4gIGdldCBlcnJSZXR1cm5UeXBlKCkge1xuICAgIHJldHVybiBBbGdlYnJhaWNUeXBlMjtcbiAgfVxufSk7XG52YXIgUmF3UmVkdWNlckRlZlY5ID0gdC5vYmplY3QoXCJSYXdSZWR1Y2VyRGVmVjlcIiwge1xuICBuYW1lOiB0LnN0cmluZygpLFxuICBnZXQgcGFyYW1zKCkge1xuICAgIHJldHVybiBQcm9kdWN0VHlwZTI7XG4gIH0sXG4gIGdldCBsaWZlY3ljbGUoKSB7XG4gICAgcmV0dXJuIHQub3B0aW9uKExpZmVjeWNsZSk7XG4gIH1cbn0pO1xudmFyIFJhd1Jvd0xldmVsU2VjdXJpdHlEZWZWOSA9IHQub2JqZWN0KFwiUmF3Um93TGV2ZWxTZWN1cml0eURlZlY5XCIsIHtcbiAgc3FsOiB0LnN0cmluZygpXG59KTtcbnZhciBSYXdTY2hlZHVsZURlZlYxMCA9IHQub2JqZWN0KFwiUmF3U2NoZWR1bGVEZWZWMTBcIiwge1xuICBzb3VyY2VOYW1lOiB0Lm9wdGlvbih0LnN0cmluZygpKSxcbiAgdGFibGVOYW1lOiB0LnN0cmluZygpLFxuICBzY2hlZHVsZUF0Q29sOiB0LnUxNigpLFxuICBmdW5jdGlvbk5hbWU6IHQuc3RyaW5nKClcbn0pO1xudmFyIFJhd1NjaGVkdWxlRGVmVjkgPSB0Lm9iamVjdChcIlJhd1NjaGVkdWxlRGVmVjlcIiwge1xuICBuYW1lOiB0Lm9wdGlvbih0LnN0cmluZygpKSxcbiAgcmVkdWNlck5hbWU6IHQuc3RyaW5nKCksXG4gIHNjaGVkdWxlZEF0Q29sdW1uOiB0LnUxNigpXG59KTtcbnZhciBSYXdTY29wZWRUeXBlTmFtZVYxMCA9IHQub2JqZWN0KFwiUmF3U2NvcGVkVHlwZU5hbWVWMTBcIiwge1xuICBzY29wZTogdC5hcnJheSh0LnN0cmluZygpKSxcbiAgc291cmNlTmFtZTogdC5zdHJpbmcoKVxufSk7XG52YXIgUmF3U2NvcGVkVHlwZU5hbWVWOSA9IHQub2JqZWN0KFwiUmF3U2NvcGVkVHlwZU5hbWVWOVwiLCB7XG4gIHNjb3BlOiB0LmFycmF5KHQuc3RyaW5nKCkpLFxuICBuYW1lOiB0LnN0cmluZygpXG59KTtcbnZhciBSYXdTZXF1ZW5jZURlZlYxMCA9IHQub2JqZWN0KFwiUmF3U2VxdWVuY2VEZWZWMTBcIiwge1xuICBzb3VyY2VOYW1lOiB0Lm9wdGlvbih0LnN0cmluZygpKSxcbiAgY29sdW1uOiB0LnUxNigpLFxuICBzdGFydDogdC5vcHRpb24odC5pMTI4KCkpLFxuICBtaW5WYWx1ZTogdC5vcHRpb24odC5pMTI4KCkpLFxuICBtYXhWYWx1ZTogdC5vcHRpb24odC5pMTI4KCkpLFxuICBpbmNyZW1lbnQ6IHQuaTEyOCgpXG59KTtcbnZhciBSYXdTZXF1ZW5jZURlZlY4ID0gdC5vYmplY3QoXCJSYXdTZXF1ZW5jZURlZlY4XCIsIHtcbiAgc2VxdWVuY2VOYW1lOiB0LnN0cmluZygpLFxuICBjb2xQb3M6IHQudTE2KCksXG4gIGluY3JlbWVudDogdC5pMTI4KCksXG4gIHN0YXJ0OiB0Lm9wdGlvbih0LmkxMjgoKSksXG4gIG1pblZhbHVlOiB0Lm9wdGlvbih0LmkxMjgoKSksXG4gIG1heFZhbHVlOiB0Lm9wdGlvbih0LmkxMjgoKSksXG4gIGFsbG9jYXRlZDogdC5pMTI4KClcbn0pO1xudmFyIFJhd1NlcXVlbmNlRGVmVjkgPSB0Lm9iamVjdChcIlJhd1NlcXVlbmNlRGVmVjlcIiwge1xuICBuYW1lOiB0Lm9wdGlvbih0LnN0cmluZygpKSxcbiAgY29sdW1uOiB0LnUxNigpLFxuICBzdGFydDogdC5vcHRpb24odC5pMTI4KCkpLFxuICBtaW5WYWx1ZTogdC5vcHRpb24odC5pMTI4KCkpLFxuICBtYXhWYWx1ZTogdC5vcHRpb24odC5pMTI4KCkpLFxuICBpbmNyZW1lbnQ6IHQuaTEyOCgpXG59KTtcbnZhciBSYXdUYWJsZURlZlYxMCA9IHQub2JqZWN0KFwiUmF3VGFibGVEZWZWMTBcIiwge1xuICBzb3VyY2VOYW1lOiB0LnN0cmluZygpLFxuICBwcm9kdWN0VHlwZVJlZjogdC51MzIoKSxcbiAgcHJpbWFyeUtleTogdC5hcnJheSh0LnUxNigpKSxcbiAgZ2V0IGluZGV4ZXMoKSB7XG4gICAgcmV0dXJuIHQuYXJyYXkoUmF3SW5kZXhEZWZWMTApO1xuICB9LFxuICBnZXQgY29uc3RyYWludHMoKSB7XG4gICAgcmV0dXJuIHQuYXJyYXkoUmF3Q29uc3RyYWludERlZlYxMCk7XG4gIH0sXG4gIGdldCBzZXF1ZW5jZXMoKSB7XG4gICAgcmV0dXJuIHQuYXJyYXkoUmF3U2VxdWVuY2VEZWZWMTApO1xuICB9LFxuICBnZXQgdGFibGVUeXBlKCkge1xuICAgIHJldHVybiBUYWJsZVR5cGU7XG4gIH0sXG4gIGdldCB0YWJsZUFjY2VzcygpIHtcbiAgICByZXR1cm4gVGFibGVBY2Nlc3M7XG4gIH0sXG4gIGdldCBkZWZhdWx0VmFsdWVzKCkge1xuICAgIHJldHVybiB0LmFycmF5KFJhd0NvbHVtbkRlZmF1bHRWYWx1ZVYxMCk7XG4gIH0sXG4gIGlzRXZlbnQ6IHQuYm9vbCgpXG59KTtcbnZhciBSYXdUYWJsZURlZlY4ID0gdC5vYmplY3QoXCJSYXdUYWJsZURlZlY4XCIsIHtcbiAgdGFibGVOYW1lOiB0LnN0cmluZygpLFxuICBnZXQgY29sdW1ucygpIHtcbiAgICByZXR1cm4gdC5hcnJheShSYXdDb2x1bW5EZWZWOCk7XG4gIH0sXG4gIGdldCBpbmRleGVzKCkge1xuICAgIHJldHVybiB0LmFycmF5KFJhd0luZGV4RGVmVjgpO1xuICB9LFxuICBnZXQgY29uc3RyYWludHMoKSB7XG4gICAgcmV0dXJuIHQuYXJyYXkoUmF3Q29uc3RyYWludERlZlY4KTtcbiAgfSxcbiAgZ2V0IHNlcXVlbmNlcygpIHtcbiAgICByZXR1cm4gdC5hcnJheShSYXdTZXF1ZW5jZURlZlY4KTtcbiAgfSxcbiAgdGFibGVUeXBlOiB0LnN0cmluZygpLFxuICB0YWJsZUFjY2VzczogdC5zdHJpbmcoKSxcbiAgc2NoZWR1bGVkOiB0Lm9wdGlvbih0LnN0cmluZygpKVxufSk7XG52YXIgUmF3VGFibGVEZWZWOSA9IHQub2JqZWN0KFwiUmF3VGFibGVEZWZWOVwiLCB7XG4gIG5hbWU6IHQuc3RyaW5nKCksXG4gIHByb2R1Y3RUeXBlUmVmOiB0LnUzMigpLFxuICBwcmltYXJ5S2V5OiB0LmFycmF5KHQudTE2KCkpLFxuICBnZXQgaW5kZXhlcygpIHtcbiAgICByZXR1cm4gdC5hcnJheShSYXdJbmRleERlZlY5KTtcbiAgfSxcbiAgZ2V0IGNvbnN0cmFpbnRzKCkge1xuICAgIHJldHVybiB0LmFycmF5KFJhd0NvbnN0cmFpbnREZWZWOSk7XG4gIH0sXG4gIGdldCBzZXF1ZW5jZXMoKSB7XG4gICAgcmV0dXJuIHQuYXJyYXkoUmF3U2VxdWVuY2VEZWZWOSk7XG4gIH0sXG4gIGdldCBzY2hlZHVsZSgpIHtcbiAgICByZXR1cm4gdC5vcHRpb24oUmF3U2NoZWR1bGVEZWZWOSk7XG4gIH0sXG4gIGdldCB0YWJsZVR5cGUoKSB7XG4gICAgcmV0dXJuIFRhYmxlVHlwZTtcbiAgfSxcbiAgZ2V0IHRhYmxlQWNjZXNzKCkge1xuICAgIHJldHVybiBUYWJsZUFjY2VzcztcbiAgfVxufSk7XG52YXIgUmF3VHlwZURlZlYxMCA9IHQub2JqZWN0KFwiUmF3VHlwZURlZlYxMFwiLCB7XG4gIGdldCBzb3VyY2VOYW1lKCkge1xuICAgIHJldHVybiBSYXdTY29wZWRUeXBlTmFtZVYxMDtcbiAgfSxcbiAgdHk6IHQudTMyKCksXG4gIGN1c3RvbU9yZGVyaW5nOiB0LmJvb2woKVxufSk7XG52YXIgUmF3VHlwZURlZlY5ID0gdC5vYmplY3QoXCJSYXdUeXBlRGVmVjlcIiwge1xuICBnZXQgbmFtZSgpIHtcbiAgICByZXR1cm4gUmF3U2NvcGVkVHlwZU5hbWVWOTtcbiAgfSxcbiAgdHk6IHQudTMyKCksXG4gIGN1c3RvbU9yZGVyaW5nOiB0LmJvb2woKVxufSk7XG52YXIgUmF3VW5pcXVlQ29uc3RyYWludERhdGFWOSA9IHQub2JqZWN0KFxuICBcIlJhd1VuaXF1ZUNvbnN0cmFpbnREYXRhVjlcIixcbiAge1xuICAgIGNvbHVtbnM6IHQuYXJyYXkodC51MTYoKSlcbiAgfVxuKTtcbnZhciBSYXdWaWV3RGVmVjEwID0gdC5vYmplY3QoXCJSYXdWaWV3RGVmVjEwXCIsIHtcbiAgc291cmNlTmFtZTogdC5zdHJpbmcoKSxcbiAgaW5kZXg6IHQudTMyKCksXG4gIGlzUHVibGljOiB0LmJvb2woKSxcbiAgaXNBbm9ueW1vdXM6IHQuYm9vbCgpLFxuICBnZXQgcGFyYW1zKCkge1xuICAgIHJldHVybiBQcm9kdWN0VHlwZTI7XG4gIH0sXG4gIGdldCByZXR1cm5UeXBlKCkge1xuICAgIHJldHVybiBBbGdlYnJhaWNUeXBlMjtcbiAgfVxufSk7XG52YXIgUmF3Vmlld0RlZlY5ID0gdC5vYmplY3QoXCJSYXdWaWV3RGVmVjlcIiwge1xuICBuYW1lOiB0LnN0cmluZygpLFxuICBpbmRleDogdC51MzIoKSxcbiAgaXNQdWJsaWM6IHQuYm9vbCgpLFxuICBpc0Fub255bW91czogdC5ib29sKCksXG4gIGdldCBwYXJhbXMoKSB7XG4gICAgcmV0dXJuIFByb2R1Y3RUeXBlMjtcbiAgfSxcbiAgZ2V0IHJldHVyblR5cGUoKSB7XG4gICAgcmV0dXJuIEFsZ2VicmFpY1R5cGUyO1xuICB9XG59KTtcbnZhciBSYXdWaWV3UHJpbWFyeUtleURlZlYxMCA9IHQub2JqZWN0KFwiUmF3Vmlld1ByaW1hcnlLZXlEZWZWMTBcIiwge1xuICB2aWV3U291cmNlTmFtZTogdC5zdHJpbmcoKSxcbiAgY29sdW1uczogdC5hcnJheSh0LnN0cmluZygpKVxufSk7XG52YXIgUmVkdWNlckRlZiA9IHQub2JqZWN0KFwiUmVkdWNlckRlZlwiLCB7XG4gIG5hbWU6IHQuc3RyaW5nKCksXG4gIGdldCBhcmdzKCkge1xuICAgIHJldHVybiB0LmFycmF5KFByb2R1Y3RUeXBlRWxlbWVudCk7XG4gIH1cbn0pO1xudmFyIFN1bVR5cGUyID0gdC5vYmplY3QoXCJTdW1UeXBlXCIsIHtcbiAgZ2V0IHZhcmlhbnRzKCkge1xuICAgIHJldHVybiB0LmFycmF5KFN1bVR5cGVWYXJpYW50KTtcbiAgfVxufSk7XG52YXIgU3VtVHlwZVZhcmlhbnQgPSB0Lm9iamVjdChcIlN1bVR5cGVWYXJpYW50XCIsIHtcbiAgbmFtZTogdC5vcHRpb24odC5zdHJpbmcoKSksXG4gIGdldCBhbGdlYnJhaWNUeXBlKCkge1xuICAgIHJldHVybiBBbGdlYnJhaWNUeXBlMjtcbiAgfVxufSk7XG52YXIgVGFibGVBY2Nlc3MgPSB0LmVudW0oXCJUYWJsZUFjY2Vzc1wiLCB7XG4gIFB1YmxpYzogdC51bml0KCksXG4gIFByaXZhdGU6IHQudW5pdCgpXG59KTtcbnZhciBUYWJsZURlc2MgPSB0Lm9iamVjdChcIlRhYmxlRGVzY1wiLCB7XG4gIGdldCBzY2hlbWEoKSB7XG4gICAgcmV0dXJuIFJhd1RhYmxlRGVmVjg7XG4gIH0sXG4gIGRhdGE6IHQudTMyKClcbn0pO1xudmFyIFRhYmxlVHlwZSA9IHQuZW51bShcIlRhYmxlVHlwZVwiLCB7XG4gIFN5c3RlbTogdC51bml0KCksXG4gIFVzZXI6IHQudW5pdCgpXG59KTtcbnZhciBUeXBlQWxpYXMgPSB0Lm9iamVjdChcIlR5cGVBbGlhc1wiLCB7XG4gIG5hbWU6IHQuc3RyaW5nKCksXG4gIHR5OiB0LnUzMigpXG59KTtcbnZhciBUeXBlc3BhY2UgPSB0Lm9iamVjdChcIlR5cGVzcGFjZVwiLCB7XG4gIGdldCB0eXBlcygpIHtcbiAgICByZXR1cm4gdC5hcnJheShBbGdlYnJhaWNUeXBlMik7XG4gIH1cbn0pO1xudmFyIFZpZXdSZXN1bHRIZWFkZXIgPSB0LmVudW0oXCJWaWV3UmVzdWx0SGVhZGVyXCIsIHtcbiAgUm93RGF0YTogdC51bml0KCksXG4gIFJhd1NxbDogdC5zdHJpbmcoKVxufSk7XG5cbi8vIHNyYy9saWIvc2NoZW1hLnRzXG5mdW5jdGlvbiB0YWJsZVRvU2NoZW1hKGFjY05hbWUsIHNjaGVtYTIsIHRhYmxlRGVmKSB7XG4gIGNvbnN0IGdldENvbE5hbWUgPSAoaSkgPT4gc2NoZW1hMi5yb3dUeXBlLmFsZ2VicmFpY1R5cGUudmFsdWUuZWxlbWVudHNbaV0ubmFtZTtcbiAgY29uc3QgcmVzb2x2ZWRJbmRleGVzID0gdGFibGVEZWYuaW5kZXhlcy5tYXAoXG4gICAgKGlkeCkgPT4ge1xuICAgICAgY29uc3QgYWNjZXNzb3JOYW1lID0gaWR4LmFjY2Vzc29yTmFtZTtcbiAgICAgIGlmICh0eXBlb2YgYWNjZXNzb3JOYW1lICE9PSBcInN0cmluZ1wiIHx8IGFjY2Vzc29yTmFtZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgICBgSW5kZXggJyR7aWR4LnNvdXJjZU5hbWUgPz8gXCI8dW5rbm93bj5cIn0nIG9uIHRhYmxlICcke3RhYmxlRGVmLnNvdXJjZU5hbWV9JyBpcyBtaXNzaW5nIGFjY2Vzc29yIG5hbWVgXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBjb25zdCBjb2x1bW5JZHMgPSBpZHguYWxnb3JpdGhtLnRhZyA9PT0gXCJEaXJlY3RcIiA/IFtpZHguYWxnb3JpdGhtLnZhbHVlXSA6IGlkeC5hbGdvcml0aG0udmFsdWU7XG4gICAgICBjb25zdCB1bmlxdWUgPSB0YWJsZURlZi5jb25zdHJhaW50cy5zb21lKFxuICAgICAgICAoYykgPT4gYy5kYXRhLnRhZyA9PT0gXCJVbmlxdWVcIiAmJiBjLmRhdGEudmFsdWUuY29sdW1ucy5ldmVyeSgoY29sKSA9PiBjb2x1bW5JZHMuaW5jbHVkZXMoY29sKSlcbiAgICAgICk7XG4gICAgICBjb25zdCBhbGdvcml0aG0gPSB7XG4gICAgICAgIEJUcmVlOiBcImJ0cmVlXCIsXG4gICAgICAgIEhhc2g6IFwiaGFzaFwiLFxuICAgICAgICBEaXJlY3Q6IFwiZGlyZWN0XCJcbiAgICAgIH1baWR4LmFsZ29yaXRobS50YWddO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbmFtZTogYWNjZXNzb3JOYW1lLFxuICAgICAgICB1bmlxdWUsXG4gICAgICAgIGFsZ29yaXRobSxcbiAgICAgICAgY29sdW1uczogY29sdW1uSWRzLm1hcChnZXRDb2xOYW1lKVxuICAgICAgfTtcbiAgICB9XG4gICk7XG4gIHJldHVybiB7XG4gICAgLy8gRm9yIGNsaWVudCxgc2NoYW1hLnRhYmxlTmFtZWAgd2lsbCBhbHdheXMgYmUgdGhlcmUgYXMgY2Fub25pY2FsIG5hbWUuXG4gICAgLy8gRm9yIG1vZHVsZSwgaWYgZXhwbGljaXQgbmFtZSBpcyBub3QgcHJvdmlkZWQgdmlhIGBuYW1lYCwgYWNjZXNzb3IgbmFtZSB3aWxsXG4gICAgLy8gYmUgdXNlZCwgaXQgaXMgc3RvcmVkIGFzIGFsaWFzIGluIGRhdGFiYXNlLCBoZW5jZSB3b3JrcyBpbiBxdWVyeSBidWlsZGVyLlxuICAgIHNvdXJjZU5hbWU6IHNjaGVtYTIudGFibGVOYW1lIHx8IGFjY05hbWUsXG4gICAgYWNjZXNzb3JOYW1lOiBhY2NOYW1lLFxuICAgIGNvbHVtbnM6IHNjaGVtYTIucm93VHlwZS5yb3csXG4gICAgLy8gdHlwZWQgYXMgVFtpXVsncm93VHlwZSddWydyb3cnXSB1bmRlciBUYWJsZXNUb1NjaGVtYTxUPlxuICAgIHJvd1R5cGU6IHNjaGVtYTIucm93U3BhY2V0aW1lVHlwZSxcbiAgICAvLyBLZWVwIGRlY2xhcmF0aXZlIGluZGV4ZXMgaW4gdGhlaXIgb3JpZ2luYWwgc2hhcGUgZm9yIHR5cGUtbGV2ZWwgY29uc3VtZXJzLlxuICAgIGluZGV4ZXM6IHNjaGVtYTIuaWR4cyxcbiAgICBjb25zdHJhaW50czogdGFibGVEZWYuY29uc3RyYWludHMubWFwKChjKSA9PiAoe1xuICAgICAgbmFtZTogYy5zb3VyY2VOYW1lLFxuICAgICAgY29uc3RyYWludDogXCJ1bmlxdWVcIixcbiAgICAgIGNvbHVtbnM6IGMuZGF0YS52YWx1ZS5jb2x1bW5zLm1hcChnZXRDb2xOYW1lKVxuICAgIH0pKSxcbiAgICAvLyBFeHBvc2UgcmVzb2x2ZWQgcnVudGltZSBpbmRleGVzIHNlcGFyYXRlbHkgc28gcnVudGltZSB1c2VycyBkb24ndCBoYXZlIHRvXG4gICAgLy8gcmVpbnRlcnByZXQgYGluZGV4ZXNgIHdpdGggdW5zYWZlIGNhc3RzLlxuICAgIHJlc29sdmVkSW5kZXhlcyxcbiAgICB0YWJsZURlZixcbiAgICAuLi50YWJsZURlZi5pc0V2ZW50ID8geyBpc0V2ZW50OiB0cnVlIH0gOiB7fVxuICB9O1xufVxudmFyIE1vZHVsZUNvbnRleHQgPSBjbGFzcyB7XG4gICNjb21wb3VuZFR5cGVzID0gLyogQF9fUFVSRV9fICovIG5ldyBNYXAoKTtcbiAgLyoqXG4gICAqIFRoZSBnbG9iYWwgbW9kdWxlIGRlZmluaXRpb24gdGhhdCBnZXRzIHBvcHVsYXRlZCBieSBjYWxscyB0byBgcmVkdWNlcigpYCBhbmQgbGlmZWN5Y2xlIGhvb2tzLlxuICAgKi9cbiAgI21vZHVsZURlZiA9IHtcbiAgICB0eXBlc3BhY2U6IHsgdHlwZXM6IFtdIH0sXG4gICAgdGFibGVzOiBbXSxcbiAgICByZWR1Y2VyczogW10sXG4gICAgdHlwZXM6IFtdLFxuICAgIHJvd0xldmVsU2VjdXJpdHk6IFtdLFxuICAgIHNjaGVkdWxlczogW10sXG4gICAgcHJvY2VkdXJlczogW10sXG4gICAgdmlld3M6IFtdLFxuICAgIHZpZXdQcmltYXJ5S2V5czogW10sXG4gICAgbGlmZUN5Y2xlUmVkdWNlcnM6IFtdLFxuICAgIGh0dHBIYW5kbGVyczogW10sXG4gICAgaHR0cFJvdXRlczogW10sXG4gICAgY2FzZUNvbnZlcnNpb25Qb2xpY3k6IHsgdGFnOiBcIlNuYWtlQ2FzZVwiIH0sXG4gICAgZXhwbGljaXROYW1lczoge1xuICAgICAgZW50cmllczogW11cbiAgICB9XG4gIH07XG4gIGdldCBtb2R1bGVEZWYoKSB7XG4gICAgcmV0dXJuIHRoaXMuI21vZHVsZURlZjtcbiAgfVxuICByYXdNb2R1bGVEZWZWMTAoKSB7XG4gICAgY29uc3Qgc2VjdGlvbnMgPSBbXTtcbiAgICBjb25zdCBwdXNoID0gKHMpID0+IHtcbiAgICAgIGlmIChzKSBzZWN0aW9ucy5wdXNoKHMpO1xuICAgIH07XG4gICAgY29uc3QgbW9kdWxlID0gdGhpcy4jbW9kdWxlRGVmO1xuICAgIHB1c2gobW9kdWxlLnR5cGVzcGFjZSAmJiB7IHRhZzogXCJUeXBlc3BhY2VcIiwgdmFsdWU6IG1vZHVsZS50eXBlc3BhY2UgfSk7XG4gICAgcHVzaChtb2R1bGUudHlwZXMgJiYgeyB0YWc6IFwiVHlwZXNcIiwgdmFsdWU6IG1vZHVsZS50eXBlcyB9KTtcbiAgICBwdXNoKG1vZHVsZS50YWJsZXMgJiYgeyB0YWc6IFwiVGFibGVzXCIsIHZhbHVlOiBtb2R1bGUudGFibGVzIH0pO1xuICAgIHB1c2gobW9kdWxlLnJlZHVjZXJzICYmIHsgdGFnOiBcIlJlZHVjZXJzXCIsIHZhbHVlOiBtb2R1bGUucmVkdWNlcnMgfSk7XG4gICAgcHVzaChtb2R1bGUucHJvY2VkdXJlcyAmJiB7IHRhZzogXCJQcm9jZWR1cmVzXCIsIHZhbHVlOiBtb2R1bGUucHJvY2VkdXJlcyB9KTtcbiAgICBwdXNoKG1vZHVsZS52aWV3cyAmJiB7IHRhZzogXCJWaWV3c1wiLCB2YWx1ZTogbW9kdWxlLnZpZXdzIH0pO1xuICAgIHB1c2goXG4gICAgICBtb2R1bGUudmlld1ByaW1hcnlLZXlzICYmIHtcbiAgICAgICAgdGFnOiBcIlZpZXdQcmltYXJ5S2V5c1wiLFxuICAgICAgICB2YWx1ZTogbW9kdWxlLnZpZXdQcmltYXJ5S2V5c1xuICAgICAgfVxuICAgICk7XG4gICAgcHVzaChtb2R1bGUuc2NoZWR1bGVzICYmIHsgdGFnOiBcIlNjaGVkdWxlc1wiLCB2YWx1ZTogbW9kdWxlLnNjaGVkdWxlcyB9KTtcbiAgICBwdXNoKFxuICAgICAgbW9kdWxlLmxpZmVDeWNsZVJlZHVjZXJzICYmIHtcbiAgICAgICAgdGFnOiBcIkxpZmVDeWNsZVJlZHVjZXJzXCIsXG4gICAgICAgIHZhbHVlOiBtb2R1bGUubGlmZUN5Y2xlUmVkdWNlcnNcbiAgICAgIH1cbiAgICApO1xuICAgIHB1c2goXG4gICAgICBtb2R1bGUuaHR0cEhhbmRsZXJzICYmIHtcbiAgICAgICAgdGFnOiBcIkh0dHBIYW5kbGVyc1wiLFxuICAgICAgICB2YWx1ZTogbW9kdWxlLmh0dHBIYW5kbGVyc1xuICAgICAgfVxuICAgICk7XG4gICAgcHVzaChcbiAgICAgIG1vZHVsZS5odHRwUm91dGVzICYmIHtcbiAgICAgICAgdGFnOiBcIkh0dHBSb3V0ZXNcIixcbiAgICAgICAgdmFsdWU6IG1vZHVsZS5odHRwUm91dGVzXG4gICAgICB9XG4gICAgKTtcbiAgICBwdXNoKFxuICAgICAgbW9kdWxlLnJvd0xldmVsU2VjdXJpdHkgJiYge1xuICAgICAgICB0YWc6IFwiUm93TGV2ZWxTZWN1cml0eVwiLFxuICAgICAgICB2YWx1ZTogbW9kdWxlLnJvd0xldmVsU2VjdXJpdHlcbiAgICAgIH1cbiAgICApO1xuICAgIHB1c2goXG4gICAgICBtb2R1bGUuZXhwbGljaXROYW1lcyAmJiB7XG4gICAgICAgIHRhZzogXCJFeHBsaWNpdE5hbWVzXCIsXG4gICAgICAgIHZhbHVlOiBtb2R1bGUuZXhwbGljaXROYW1lc1xuICAgICAgfVxuICAgICk7XG4gICAgcHVzaChcbiAgICAgIG1vZHVsZS5jYXNlQ29udmVyc2lvblBvbGljeSAmJiB7XG4gICAgICAgIHRhZzogXCJDYXNlQ29udmVyc2lvblBvbGljeVwiLFxuICAgICAgICB2YWx1ZTogbW9kdWxlLmNhc2VDb252ZXJzaW9uUG9saWN5XG4gICAgICB9XG4gICAgKTtcbiAgICByZXR1cm4geyBzZWN0aW9ucyB9O1xuICB9XG4gIC8qKlxuICAgKiBTZXQgdGhlIGNhc2UgY29udmVyc2lvbiBwb2xpY3kgZm9yIHRoaXMgbW9kdWxlLlxuICAgKiBDYWxsZWQgYnkgdGhlIHNldHRpbmdzIG1lY2hhbmlzbS5cbiAgICovXG4gIHNldENhc2VDb252ZXJzaW9uUG9saWN5KHBvbGljeSkge1xuICAgIHRoaXMuI21vZHVsZURlZi5jYXNlQ29udmVyc2lvblBvbGljeSA9IHBvbGljeTtcbiAgfVxuICBnZXQgdHlwZXNwYWNlKCkge1xuICAgIHJldHVybiB0aGlzLiNtb2R1bGVEZWYudHlwZXNwYWNlO1xuICB9XG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgYWN0dWFsIHR5cGUgb2YgYSBUeXBlQnVpbGRlciBieSBmb2xsb3dpbmcgaXRzIHJlZmVyZW5jZXMgdW50aWwgaXQgcmVhY2hlcyBhIG5vbi1yZWYgdHlwZS5cbiAgICogQHBhcmFtIHR5cGVzcGFjZSBUaGUgdHlwZXNwYWNlIHRvIHJlc29sdmUgdHlwZXMgYWdhaW5zdC5cbiAgICogQHBhcmFtIHR5cGVCdWlsZGVyIFRoZSBUeXBlQnVpbGRlciB0byByZXNvbHZlLlxuICAgKiBAcmV0dXJucyBUaGUgcmVzb2x2ZWQgYWxnZWJyYWljIHR5cGUuXG4gICAqL1xuICByZXNvbHZlVHlwZSh0eXBlQnVpbGRlcikge1xuICAgIGxldCB0eSA9IHR5cGVCdWlsZGVyLmFsZ2VicmFpY1R5cGU7XG4gICAgd2hpbGUgKHR5LnRhZyA9PT0gXCJSZWZcIikge1xuICAgICAgdHkgPSB0aGlzLnR5cGVzcGFjZS50eXBlc1t0eS52YWx1ZV07XG4gICAgfVxuICAgIHJldHVybiB0eTtcbiAgfVxuICAvKipcbiAgICogQWRkcyBhIHR5cGUgdG8gdGhlIG1vZHVsZSBkZWZpbml0aW9uJ3MgdHlwZXNwYWNlIGFzIGEgYFJlZmAgaWYgaXQgaXMgYSBuYW1lZCBjb21wb3VuZCB0eXBlIChQcm9kdWN0IG9yIFN1bSkuXG4gICAqIE90aGVyd2lzZSwgcmV0dXJucyB0aGUgdHlwZSBhcyBpcy5cbiAgICogQHBhcmFtIG5hbWVcbiAgICogQHBhcmFtIHR5XG4gICAqIEByZXR1cm5zXG4gICAqL1xuICByZWdpc3RlclR5cGVzUmVjdXJzaXZlbHkodHlwZUJ1aWxkZXIpIHtcbiAgICBpZiAodHlwZUJ1aWxkZXIgaW5zdGFuY2VvZiBQcm9kdWN0QnVpbGRlciAmJiAhaXNVbml0KHR5cGVCdWlsZGVyKSB8fCB0eXBlQnVpbGRlciBpbnN0YW5jZW9mIFN1bUJ1aWxkZXIgfHwgdHlwZUJ1aWxkZXIgaW5zdGFuY2VvZiBSb3dCdWlsZGVyKSB7XG4gICAgICByZXR1cm4gdGhpcy4jcmVnaXN0ZXJDb21wb3VuZFR5cGVSZWN1cnNpdmVseSh0eXBlQnVpbGRlcik7XG4gICAgfSBlbHNlIGlmICh0eXBlQnVpbGRlciBpbnN0YW5jZW9mIE9wdGlvbkJ1aWxkZXIpIHtcbiAgICAgIHJldHVybiBuZXcgT3B0aW9uQnVpbGRlcihcbiAgICAgICAgdGhpcy5yZWdpc3RlclR5cGVzUmVjdXJzaXZlbHkodHlwZUJ1aWxkZXIudmFsdWUpXG4gICAgICApO1xuICAgIH0gZWxzZSBpZiAodHlwZUJ1aWxkZXIgaW5zdGFuY2VvZiBSZXN1bHRCdWlsZGVyKSB7XG4gICAgICByZXR1cm4gbmV3IFJlc3VsdEJ1aWxkZXIoXG4gICAgICAgIHRoaXMucmVnaXN0ZXJUeXBlc1JlY3Vyc2l2ZWx5KHR5cGVCdWlsZGVyLm9rKSxcbiAgICAgICAgdGhpcy5yZWdpc3RlclR5cGVzUmVjdXJzaXZlbHkodHlwZUJ1aWxkZXIuZXJyKVxuICAgICAgKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVCdWlsZGVyIGluc3RhbmNlb2YgQXJyYXlCdWlsZGVyKSB7XG4gICAgICByZXR1cm4gbmV3IEFycmF5QnVpbGRlcihcbiAgICAgICAgdGhpcy5yZWdpc3RlclR5cGVzUmVjdXJzaXZlbHkodHlwZUJ1aWxkZXIuZWxlbWVudClcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB0eXBlQnVpbGRlcjtcbiAgICB9XG4gIH1cbiAgI3JlZ2lzdGVyQ29tcG91bmRUeXBlUmVjdXJzaXZlbHkodHlwZUJ1aWxkZXIpIHtcbiAgICBjb25zdCB0eSA9IHR5cGVCdWlsZGVyLmFsZ2VicmFpY1R5cGU7XG4gICAgY29uc3QgbmFtZSA9IHR5cGVCdWlsZGVyLnR5cGVOYW1lO1xuICAgIGlmIChuYW1lID09PSB2b2lkIDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYE1pc3NpbmcgdHlwZSBuYW1lIGZvciAke3R5cGVCdWlsZGVyLmNvbnN0cnVjdG9yLm5hbWUgPz8gXCJUeXBlQnVpbGRlclwifSAke0pTT04uc3RyaW5naWZ5KHR5cGVCdWlsZGVyKX1gXG4gICAgICApO1xuICAgIH1cbiAgICBsZXQgciA9IHRoaXMuI2NvbXBvdW5kVHlwZXMuZ2V0KHR5KTtcbiAgICBpZiAociAhPSBudWxsKSB7XG4gICAgICByZXR1cm4gcjtcbiAgICB9XG4gICAgY29uc3QgbmV3VHkgPSB0eXBlQnVpbGRlciBpbnN0YW5jZW9mIFJvd0J1aWxkZXIgfHwgdHlwZUJ1aWxkZXIgaW5zdGFuY2VvZiBQcm9kdWN0QnVpbGRlciA/IHtcbiAgICAgIHRhZzogXCJQcm9kdWN0XCIsXG4gICAgICB2YWx1ZTogeyBlbGVtZW50czogW10gfVxuICAgIH0gOiB7XG4gICAgICB0YWc6IFwiU3VtXCIsXG4gICAgICB2YWx1ZTogeyB2YXJpYW50czogW10gfVxuICAgIH07XG4gICAgciA9IG5ldyBSZWZCdWlsZGVyKHRoaXMuI21vZHVsZURlZi50eXBlc3BhY2UudHlwZXMubGVuZ3RoKTtcbiAgICB0aGlzLiNtb2R1bGVEZWYudHlwZXNwYWNlLnR5cGVzLnB1c2gobmV3VHkpO1xuICAgIHRoaXMuI2NvbXBvdW5kVHlwZXMuc2V0KHR5LCByKTtcbiAgICBpZiAodHlwZUJ1aWxkZXIgaW5zdGFuY2VvZiBSb3dCdWlsZGVyKSB7XG4gICAgICBmb3IgKGNvbnN0IFtuYW1lMiwgZWxlbV0gb2YgT2JqZWN0LmVudHJpZXModHlwZUJ1aWxkZXIucm93KSkge1xuICAgICAgICBuZXdUeS52YWx1ZS5lbGVtZW50cy5wdXNoKHtcbiAgICAgICAgICBuYW1lOiBuYW1lMixcbiAgICAgICAgICBhbGdlYnJhaWNUeXBlOiB0aGlzLnJlZ2lzdGVyVHlwZXNSZWN1cnNpdmVseShlbGVtLnR5cGVCdWlsZGVyKS5hbGdlYnJhaWNUeXBlXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodHlwZUJ1aWxkZXIgaW5zdGFuY2VvZiBQcm9kdWN0QnVpbGRlcikge1xuICAgICAgZm9yIChjb25zdCBbbmFtZTIsIGVsZW1dIG9mIE9iamVjdC5lbnRyaWVzKHR5cGVCdWlsZGVyLmVsZW1lbnRzKSkge1xuICAgICAgICBuZXdUeS52YWx1ZS5lbGVtZW50cy5wdXNoKHtcbiAgICAgICAgICBuYW1lOiBuYW1lMixcbiAgICAgICAgICBhbGdlYnJhaWNUeXBlOiB0aGlzLnJlZ2lzdGVyVHlwZXNSZWN1cnNpdmVseShlbGVtKS5hbGdlYnJhaWNUeXBlXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodHlwZUJ1aWxkZXIgaW5zdGFuY2VvZiBTdW1CdWlsZGVyKSB7XG4gICAgICBmb3IgKGNvbnN0IFtuYW1lMiwgdmFyaWFudF0gb2YgT2JqZWN0LmVudHJpZXModHlwZUJ1aWxkZXIudmFyaWFudHMpKSB7XG4gICAgICAgIG5ld1R5LnZhbHVlLnZhcmlhbnRzLnB1c2goe1xuICAgICAgICAgIG5hbWU6IG5hbWUyLFxuICAgICAgICAgIGFsZ2VicmFpY1R5cGU6IHRoaXMucmVnaXN0ZXJUeXBlc1JlY3Vyc2l2ZWx5KHZhcmlhbnQpLmFsZ2VicmFpY1R5cGVcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuI21vZHVsZURlZi50eXBlcy5wdXNoKHtcbiAgICAgIHNvdXJjZU5hbWU6IHNwbGl0TmFtZShuYW1lKSxcbiAgICAgIHR5OiByLnJlZixcbiAgICAgIGN1c3RvbU9yZGVyaW5nOiB0cnVlXG4gICAgfSk7XG4gICAgcmV0dXJuIHI7XG4gIH1cbn07XG5mdW5jdGlvbiBpc1VuaXQodHlwZUJ1aWxkZXIpIHtcbiAgcmV0dXJuIHR5cGVCdWlsZGVyLnR5cGVOYW1lID09IG51bGwgJiYgdHlwZUJ1aWxkZXIuYWxnZWJyYWljVHlwZS52YWx1ZS5lbGVtZW50cy5sZW5ndGggPT09IDA7XG59XG5mdW5jdGlvbiBzcGxpdE5hbWUobmFtZSkge1xuICBjb25zdCBzY29wZSA9IG5hbWUuc3BsaXQoXCIuXCIpO1xuICByZXR1cm4geyBzb3VyY2VOYW1lOiBzY29wZS5wb3AoKSwgc2NvcGUgfTtcbn1cbnZhciB0ZXh0RW5jb2RlciA9IG5ldyBUZXh0RW5jb2RlcigpO1xudmFyIHRleHREZWNvZGVyID0gbmV3IFRleHREZWNvZGVyKFwidXRmLThcIik7XG5mdW5jdGlvbiBkZXNlcmlhbGl6ZU1ldGhvZChtZXRob2QpIHtcbiAgc3dpdGNoIChtZXRob2QudGFnKSB7XG4gICAgY2FzZSBcIkdldFwiOlxuICAgICAgcmV0dXJuIFwiR0VUXCI7XG4gICAgY2FzZSBcIkhlYWRcIjpcbiAgICAgIHJldHVybiBcIkhFQURcIjtcbiAgICBjYXNlIFwiUG9zdFwiOlxuICAgICAgcmV0dXJuIFwiUE9TVFwiO1xuICAgIGNhc2UgXCJQdXRcIjpcbiAgICAgIHJldHVybiBcIlBVVFwiO1xuICAgIGNhc2UgXCJEZWxldGVcIjpcbiAgICAgIHJldHVybiBcIkRFTEVURVwiO1xuICAgIGNhc2UgXCJDb25uZWN0XCI6XG4gICAgICByZXR1cm4gXCJDT05ORUNUXCI7XG4gICAgY2FzZSBcIk9wdGlvbnNcIjpcbiAgICAgIHJldHVybiBcIk9QVElPTlNcIjtcbiAgICBjYXNlIFwiVHJhY2VcIjpcbiAgICAgIHJldHVybiBcIlRSQUNFXCI7XG4gICAgY2FzZSBcIlBhdGNoXCI6XG4gICAgICByZXR1cm4gXCJQQVRDSFwiO1xuICAgIGNhc2UgXCJFeHRlbnNpb25cIjpcbiAgICAgIHJldHVybiBtZXRob2QudmFsdWU7XG4gIH1cbn1cbnZhciBtZXRob2RzID0gLyogQF9fUFVSRV9fICovIG5ldyBNYXAoW1xuICBbXCJHRVRcIiwgeyB0YWc6IFwiR2V0XCIgfV0sXG4gIFtcIkhFQURcIiwgeyB0YWc6IFwiSGVhZFwiIH1dLFxuICBbXCJQT1NUXCIsIHsgdGFnOiBcIlBvc3RcIiB9XSxcbiAgW1wiUFVUXCIsIHsgdGFnOiBcIlB1dFwiIH1dLFxuICBbXCJERUxFVEVcIiwgeyB0YWc6IFwiRGVsZXRlXCIgfV0sXG4gIFtcIkNPTk5FQ1RcIiwgeyB0YWc6IFwiQ29ubmVjdFwiIH1dLFxuICBbXCJPUFRJT05TXCIsIHsgdGFnOiBcIk9wdGlvbnNcIiB9XSxcbiAgW1wiVFJBQ0VcIiwgeyB0YWc6IFwiVHJhY2VcIiB9XSxcbiAgW1wiUEFUQ0hcIiwgeyB0YWc6IFwiUGF0Y2hcIiB9XVxuXSk7XG5mdW5jdGlvbiBzZXJpYWxpemVNZXRob2QobWV0aG9kKSB7XG4gIHJldHVybiBtZXRob2RzLmdldChtZXRob2Q/LnRvVXBwZXJDYXNlKCkgPz8gXCJHRVRcIikgPz8ge1xuICAgIHRhZzogXCJFeHRlbnNpb25cIixcbiAgICB2YWx1ZTogbWV0aG9kXG4gIH07XG59XG5mdW5jdGlvbiBzZXJpYWxpemVIZWFkZXJzKGhlYWRlcnMpIHtcbiAgcmV0dXJuIHtcbiAgICBlbnRyaWVzOiBoZWFkZXJzVG9MaXN0KGhlYWRlcnMpLmZsYXRNYXAoKFtrLCB2XSkgPT4gQXJyYXkuaXNBcnJheSh2KSA/IHYubWFwKCh2MikgPT4gW2ssIHYyXSkgOiBbW2ssIHZdXSkubWFwKChbbmFtZSwgdmFsdWVdKSA9PiAoeyBuYW1lLCB2YWx1ZTogdGV4dEVuY29kZXIuZW5jb2RlKHZhbHVlKSB9KSlcbiAgfTtcbn1cbmZ1bmN0aW9uIGRlc2VyaWFsaXplSGVhZGVycyhoZWFkZXJzKSB7XG4gIHJldHVybiBuZXcgSGVhZGVycyhcbiAgICBoZWFkZXJzLmVudHJpZXMubWFwKCh7IG5hbWUsIHZhbHVlIH0pID0+IFtcbiAgICAgIG5hbWUsXG4gICAgICB0ZXh0RGVjb2Rlci5kZWNvZGUodmFsdWUpXG4gICAgXSlcbiAgKTtcbn1cbnZhciBtYWtlUmVzcG9uc2UgPSBTeW1ib2woXCJtYWtlUmVzcG9uc2VcIik7XG52YXIgU3luY1Jlc3BvbnNlID0gY2xhc3MgX1N5bmNSZXNwb25zZSB7XG4gICNib2R5O1xuICAjaW5uZXI7XG4gIGNvbnN0cnVjdG9yKGJvZHksIGluaXQpIHtcbiAgICBpZiAoYm9keSA9PSBudWxsKSB7XG4gICAgICB0aGlzLiNib2R5ID0gbnVsbDtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBib2R5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aGlzLiNib2R5ID0gYm9keTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy4jYm9keSA9IG5ldyBVaW50OEFycmF5KGJvZHkpLmJ1ZmZlcjtcbiAgICB9XG4gICAgdGhpcy4jaW5uZXIgPSB7XG4gICAgICBoZWFkZXJzOiBuZXcgSGVhZGVycyhpbml0Py5oZWFkZXJzKSxcbiAgICAgIHN0YXR1czogaW5pdD8uc3RhdHVzID8/IDIwMCxcbiAgICAgIHN0YXR1c1RleHQ6IGluaXQ/LnN0YXR1c1RleHQgPz8gXCJcIixcbiAgICAgIHR5cGU6IFwiZGVmYXVsdFwiLFxuICAgICAgdXJsOiBudWxsLFxuICAgICAgYWJvcnRlZDogZmFsc2UsXG4gICAgICB2ZXJzaW9uOiBpbml0Py52ZXJzaW9uID8/IHsgdGFnOiBcIkh0dHAxMVwiIH1cbiAgICB9O1xuICB9XG4gIHN0YXRpYyBbbWFrZVJlc3BvbnNlXShib2R5LCBpbm5lcikge1xuICAgIGNvbnN0IG1lID0gbmV3IF9TeW5jUmVzcG9uc2UoYm9keSk7XG4gICAgbWUuI2lubmVyID0gaW5uZXI7XG4gICAgcmV0dXJuIG1lO1xuICB9XG4gIGdldCBoZWFkZXJzKCkge1xuICAgIHJldHVybiB0aGlzLiNpbm5lci5oZWFkZXJzO1xuICB9XG4gIGdldCBzdGF0dXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuI2lubmVyLnN0YXR1cztcbiAgfVxuICBnZXQgc3RhdHVzVGV4dCgpIHtcbiAgICByZXR1cm4gdGhpcy4jaW5uZXIuc3RhdHVzVGV4dDtcbiAgfVxuICBnZXQgb2soKSB7XG4gICAgcmV0dXJuIDIwMCA8PSB0aGlzLiNpbm5lci5zdGF0dXMgJiYgdGhpcy4jaW5uZXIuc3RhdHVzIDw9IDI5OTtcbiAgfVxuICBnZXQgdXJsKCkge1xuICAgIHJldHVybiB0aGlzLiNpbm5lci51cmwgPz8gXCJcIjtcbiAgfVxuICBnZXQgdHlwZSgpIHtcbiAgICByZXR1cm4gdGhpcy4jaW5uZXIudHlwZTtcbiAgfVxuICBnZXQgdmVyc2lvbigpIHtcbiAgICByZXR1cm4gdGhpcy4jaW5uZXIudmVyc2lvbjtcbiAgfVxuICBhcnJheUJ1ZmZlcigpIHtcbiAgICByZXR1cm4gdGhpcy5ieXRlcygpLmJ1ZmZlcjtcbiAgfVxuICBieXRlcygpIHtcbiAgICBpZiAodGhpcy4jYm9keSA9PSBudWxsKSB7XG4gICAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB0aGlzLiNib2R5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICByZXR1cm4gdGV4dEVuY29kZXIuZW5jb2RlKHRoaXMuI2JvZHkpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkodGhpcy4jYm9keSk7XG4gICAgfVxuICB9XG4gIGpzb24oKSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2UodGhpcy50ZXh0KCkpO1xuICB9XG4gIHRleHQoKSB7XG4gICAgaWYgKHRoaXMuI2JvZHkgPT0gbnVsbCkge1xuICAgICAgcmV0dXJuIFwiXCI7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdGhpcy4jYm9keSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHRoaXMuI2JvZHk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB0ZXh0RGVjb2Rlci5kZWNvZGUodGhpcy4jYm9keSk7XG4gICAgfVxuICB9XG59O1xuXG4vLyBzcmMvc2VydmVyL2h0dHBfaGFuZGxlcnMudHNcbnZhciBodHRwSGFuZGxlckZuID0gU3ltYm9sKFwiU3BhY2V0aW1lREIuaHR0cEhhbmRsZXJGblwiKTtcbnZhciBBQ0NFUFRBQkxFX1JPVVRFX1BBVEhfQ0hBUlNfSFVNQU5fREVTQ1JJUFRJT04gPSBcIkFTQ0lJIGxvd2VyY2FzZSBsZXR0ZXJzLCBkaWdpdHMgYW5kIGAtX34vYFwiO1xudmFyIG1ha2VSZXF1ZXN0ID0gU3ltYm9sKFwibWFrZVJlcXVlc3RcIik7XG5mdW5jdGlvbiBjb2VyY2VSZXF1ZXN0Qm9keShib2R5KSB7XG4gIGlmIChib2R5ID09IG51bGwpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBpZiAodHlwZW9mIGJvZHkgPT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gYm9keTtcbiAgfVxuICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYm9keSk7XG59XG5mdW5jdGlvbiByZXF1ZXN0Qm9keVRvQnl0ZXMoYm9keSkge1xuICBpZiAoYm9keSA9PSBudWxsKSB7XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KCk7XG4gIH1cbiAgaWYgKHR5cGVvZiBib2R5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgcmV0dXJuIHRleHRFbmNvZGVyLmVuY29kZShib2R5KTtcbiAgfVxuICByZXR1cm4gYm9keTtcbn1cbmZ1bmN0aW9uIHJlcXVlc3RCb2R5VG9UZXh0KGJvZHkpIHtcbiAgaWYgKGJvZHkgPT0gbnVsbCkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG4gIGlmICh0eXBlb2YgYm9keSA9PT0gXCJzdHJpbmdcIikge1xuICAgIHJldHVybiBib2R5O1xuICB9XG4gIHJldHVybiB0ZXh0RGVjb2Rlci5kZWNvZGUoYm9keSk7XG59XG5mdW5jdGlvbiBjaGFyYWN0ZXJJc0FjY2VwdGFibGVGb3JSb3V0ZVBhdGgoYykge1xuICByZXR1cm4gYyA+PSBcImFcIiAmJiBjIDw9IFwielwiIHx8IGMgPj0gXCIwXCIgJiYgYyA8PSBcIjlcIiB8fCBjID09PSBcIi1cIiB8fCBjID09PSBcIl9cIiB8fCBjID09PSBcIn5cIiB8fCBjID09PSBcIi9cIjtcbn1cbmZ1bmN0aW9uIGFzc2VydFZhbGlkUGF0aChwYXRoKSB7XG4gIGlmIChwYXRoICE9PSBcIlwiICYmICFwYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgUm91dGUgcGF0aHMgbXVzdCBzdGFydCB3aXRoIFxcYC9cXGA6ICR7cGF0aH1gKTtcbiAgfVxuICBpZiAoIVsuLi5wYXRoXS5ldmVyeShjaGFyYWN0ZXJJc0FjY2VwdGFibGVGb3JSb3V0ZVBhdGgpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgIGBSb3V0ZSBwYXRocyBtYXkgY29udGFpbiBvbmx5ICR7QUNDRVBUQUJMRV9ST1VURV9QQVRIX0NIQVJTX0hVTUFOX0RFU0NSSVBUSU9OfTogJHtwYXRofWBcbiAgICApO1xuICB9XG59XG5mdW5jdGlvbiByb3V0ZXNPdmVybGFwKGEsIGIpIHtcbiAgY29uc3QgbWV0aG9kc01hdGNoID0gKGxlZnQsIHJpZ2h0KSA9PiB7XG4gICAgaWYgKGxlZnQudGFnICE9PSByaWdodC50YWcpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKGxlZnQudGFnID09PSBcIkV4dGVuc2lvblwiICYmIHJpZ2h0LnRhZyA9PT0gXCJFeHRlbnNpb25cIikge1xuICAgICAgcmV0dXJuIGxlZnQudmFsdWUgPT09IHJpZ2h0LnZhbHVlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcbiAgcmV0dXJuIGEucGF0aCA9PT0gYi5wYXRoICYmIChhLm1ldGhvZC50YWcgPT09IFwiQW55XCIgfHwgYi5tZXRob2QudGFnID09PSBcIkFueVwiIHx8IGEubWV0aG9kLnRhZyA9PT0gXCJNZXRob2RcIiAmJiBiLm1ldGhvZC50YWcgPT09IFwiTWV0aG9kXCIgJiYgbWV0aG9kc01hdGNoKGEubWV0aG9kLnZhbHVlLCBiLm1ldGhvZC52YWx1ZSkpO1xufVxuZnVuY3Rpb24gam9pblBhdGhzKHByZWZpeCwgc3VmZml4KSB7XG4gIGlmIChwcmVmaXggPT09IFwiL1wiKSB7XG4gICAgcmV0dXJuIHN1ZmZpeDtcbiAgfVxuICBpZiAoc3VmZml4ID09PSBcIi9cIikge1xuICAgIHJldHVybiBwcmVmaXg7XG4gIH1cbiAgbGV0IHByZWZpeEVuZCA9IHByZWZpeC5sZW5ndGg7XG4gIHdoaWxlIChwcmVmaXhFbmQgPiAwICYmIHByZWZpeFtwcmVmaXhFbmQgLSAxXSA9PT0gXCIvXCIpIHtcbiAgICBwcmVmaXhFbmQtLTtcbiAgfVxuICBsZXQgc3VmZml4U3RhcnQgPSAwO1xuICB3aGlsZSAoc3VmZml4U3RhcnQgPCBzdWZmaXgubGVuZ3RoICYmIHN1ZmZpeFtzdWZmaXhTdGFydF0gPT09IFwiL1wiKSB7XG4gICAgc3VmZml4U3RhcnQrKztcbiAgfVxuICBjb25zdCBqb2luZWRQcmVmaXggPSBwcmVmaXguc2xpY2UoMCwgcHJlZml4RW5kKTtcbiAgY29uc3Qgam9pbmVkU3VmZml4ID0gc3VmZml4LnNsaWNlKHN1ZmZpeFN0YXJ0KTtcbiAgcmV0dXJuIGAke2pvaW5lZFByZWZpeH0vJHtqb2luZWRTdWZmaXh9YDtcbn1cbnZhciBSZXF1ZXN0ID0gY2xhc3MgX1JlcXVlc3Qge1xuICAjYm9keTtcbiAgI2lubmVyO1xuICBjb25zdHJ1Y3Rvcih1cmwsIGluaXQgPSB7fSkge1xuICAgIHRoaXMuI2JvZHkgPSBjb2VyY2VSZXF1ZXN0Qm9keShpbml0LmJvZHkpO1xuICAgIHRoaXMuI2lubmVyID0ge1xuICAgICAgaGVhZGVyczogbmV3IEhlYWRlcnMoaW5pdC5oZWFkZXJzKSxcbiAgICAgIG1ldGhvZDogaW5pdC5tZXRob2QgPz8gXCJHRVRcIixcbiAgICAgIHVyaTogXCJcIiArIHVybCxcbiAgICAgIHZlcnNpb246IGluaXQudmVyc2lvbiA/PyB7IHRhZzogXCJIdHRwMTFcIiB9XG4gICAgfTtcbiAgfVxuICBzdGF0aWMgW21ha2VSZXF1ZXN0XShib2R5LCBpbm5lcikge1xuICAgIGNvbnN0IG1lID0gbmV3IF9SZXF1ZXN0KGlubmVyLnVyaSk7XG4gICAgbWUuI2JvZHkgPSBjb2VyY2VSZXF1ZXN0Qm9keShib2R5KTtcbiAgICBtZS4jaW5uZXIgPSBpbm5lcjtcbiAgICByZXR1cm4gbWU7XG4gIH1cbiAgZ2V0IGhlYWRlcnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuI2lubmVyLmhlYWRlcnM7XG4gIH1cbiAgZ2V0IG1ldGhvZCgpIHtcbiAgICByZXR1cm4gdGhpcy4jaW5uZXIubWV0aG9kO1xuICB9XG4gIGdldCB1cmkoKSB7XG4gICAgcmV0dXJuIHRoaXMuI2lubmVyLnVyaTtcbiAgfVxuICBnZXQgdXJsKCkge1xuICAgIHJldHVybiB0aGlzLiNpbm5lci51cmk7XG4gIH1cbiAgZ2V0IHZlcnNpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuI2lubmVyLnZlcnNpb247XG4gIH1cbiAgYXJyYXlCdWZmZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuYnl0ZXMoKS5idWZmZXI7XG4gIH1cbiAgYnl0ZXMoKSB7XG4gICAgcmV0dXJuIHJlcXVlc3RCb2R5VG9CeXRlcyh0aGlzLiNib2R5KTtcbiAgfVxuICBqc29uKCkge1xuICAgIHJldHVybiBKU09OLnBhcnNlKHRoaXMudGV4dCgpKTtcbiAgfVxuICB0ZXh0KCkge1xuICAgIHJldHVybiByZXF1ZXN0Qm9keVRvVGV4dCh0aGlzLiNib2R5KTtcbiAgfVxufTtcbnZhciBleHBvcnRlZEh0dHBIYW5kbGVyT2JqZWN0cyA9IC8qIEBfX1BVUkVfXyAqLyBuZXcgV2Vha1NldCgpO1xudmFyIFJvdXRlciA9IGNsYXNzIF9Sb3V0ZXIge1xuICAjcm91dGVzO1xuICBjb25zdHJ1Y3Rvcihyb3V0ZXMgPSBbXSkge1xuICAgIHRoaXMuI3JvdXRlcyA9IHJvdXRlcztcbiAgfVxuICBnZXQocGF0aCwgaGFuZGxlcikge1xuICAgIHJldHVybiB0aGlzLmFkZFJvdXRlKFxuICAgICAgeyB0YWc6IFwiTWV0aG9kXCIsIHZhbHVlOiB7IHRhZzogXCJHZXRcIiB9IH0sXG4gICAgICBwYXRoLFxuICAgICAgaGFuZGxlclxuICAgICk7XG4gIH1cbiAgaGVhZChwYXRoLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRkUm91dGUoXG4gICAgICB7IHRhZzogXCJNZXRob2RcIiwgdmFsdWU6IHsgdGFnOiBcIkhlYWRcIiB9IH0sXG4gICAgICBwYXRoLFxuICAgICAgaGFuZGxlclxuICAgICk7XG4gIH1cbiAgb3B0aW9ucyhwYXRoLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRkUm91dGUoXG4gICAgICB7IHRhZzogXCJNZXRob2RcIiwgdmFsdWU6IHsgdGFnOiBcIk9wdGlvbnNcIiB9IH0sXG4gICAgICBwYXRoLFxuICAgICAgaGFuZGxlclxuICAgICk7XG4gIH1cbiAgcHV0KHBhdGgsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRSb3V0ZShcbiAgICAgIHsgdGFnOiBcIk1ldGhvZFwiLCB2YWx1ZTogeyB0YWc6IFwiUHV0XCIgfSB9LFxuICAgICAgcGF0aCxcbiAgICAgIGhhbmRsZXJcbiAgICApO1xuICB9XG4gIGRlbGV0ZShwYXRoLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRkUm91dGUoXG4gICAgICB7IHRhZzogXCJNZXRob2RcIiwgdmFsdWU6IHsgdGFnOiBcIkRlbGV0ZVwiIH0gfSxcbiAgICAgIHBhdGgsXG4gICAgICBoYW5kbGVyXG4gICAgKTtcbiAgfVxuICBwb3N0KHBhdGgsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRSb3V0ZShcbiAgICAgIHsgdGFnOiBcIk1ldGhvZFwiLCB2YWx1ZTogeyB0YWc6IFwiUG9zdFwiIH0gfSxcbiAgICAgIHBhdGgsXG4gICAgICBoYW5kbGVyXG4gICAgKTtcbiAgfVxuICBwYXRjaChwYXRoLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRkUm91dGUoXG4gICAgICB7IHRhZzogXCJNZXRob2RcIiwgdmFsdWU6IHsgdGFnOiBcIlBhdGNoXCIgfSB9LFxuICAgICAgcGF0aCxcbiAgICAgIGhhbmRsZXJcbiAgICApO1xuICB9XG4gIGFueShwYXRoLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRkUm91dGUoeyB0YWc6IFwiQW55XCIgfSwgcGF0aCwgaGFuZGxlcik7XG4gIH1cbiAgbmVzdChwYXRoLCBzdWJSb3V0ZXIpIHtcbiAgICBhc3NlcnRWYWxpZFBhdGgocGF0aCk7XG4gICAgaWYgKHRoaXMuI3JvdXRlcy5zb21lKChyb3V0ZSkgPT4gcm91dGUucGF0aC5zdGFydHNXaXRoKHBhdGgpKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgYENhbm5vdCBuZXN0IHJvdXRlciBhdCBcXGAke3BhdGh9XFxgOyBleGlzdGluZyByb3V0ZXMgb3ZlcmxhcCB3aXRoIG5lc3RlZCBwYXRoYFxuICAgICAgKTtcbiAgICB9XG4gICAgbGV0IG1lcmdlZCA9IG5ldyBfUm91dGVyKHRoaXMuI3JvdXRlcyk7XG4gICAgZm9yIChjb25zdCByb3V0ZSBvZiBzdWJSb3V0ZXIuI3JvdXRlcykge1xuICAgICAgbWVyZ2VkID0gbWVyZ2VkLmFkZFJvdXRlKFxuICAgICAgICByb3V0ZS5tZXRob2QsXG4gICAgICAgIGpvaW5QYXRocyhwYXRoLCByb3V0ZS5wYXRoKSxcbiAgICAgICAgcm91dGUuaGFuZGxlclxuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIG1lcmdlZDtcbiAgfVxuICBtZXJnZShvdGhlclJvdXRlcikge1xuICAgIGxldCBtZXJnZWQgPSBuZXcgX1JvdXRlcih0aGlzLiNyb3V0ZXMpO1xuICAgIGZvciAoY29uc3Qgcm91dGUgb2Ygb3RoZXJSb3V0ZXIuI3JvdXRlcykge1xuICAgICAgbWVyZ2VkID0gbWVyZ2VkLmFkZFJvdXRlKHJvdXRlLm1ldGhvZCwgcm91dGUucGF0aCwgcm91dGUuaGFuZGxlcik7XG4gICAgfVxuICAgIHJldHVybiBtZXJnZWQ7XG4gIH1cbiAgaW50b1JvdXRlcygpIHtcbiAgICByZXR1cm4gdGhpcy4jcm91dGVzLnNsaWNlKCk7XG4gIH1cbiAgYWRkUm91dGUobWV0aG9kLCBwYXRoLCBoYW5kbGVyKSB7XG4gICAgYXNzZXJ0VmFsaWRQYXRoKHBhdGgpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IHsgbWV0aG9kLCBwYXRoLCBoYW5kbGVyIH07XG4gICAgaWYgKHRoaXMuI3JvdXRlcy5zb21lKChyb3V0ZSkgPT4gcm91dGVzT3ZlcmxhcChyb3V0ZSwgY2FuZGlkYXRlKSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYFJvdXRlIGNvbmZsaWN0IGZvciBcXGAke3BhdGh9XFxgYCk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgX1JvdXRlcihbLi4udGhpcy4jcm91dGVzLCBjYW5kaWRhdGVdKTtcbiAgfVxufTtcbmZ1bmN0aW9uIG1ha2VIdHRwSGFuZGxlckV4cG9ydChjdHgsIG9wdHMsIGZuKSB7XG4gIGNvbnN0IGhhbmRsZXJFeHBvcnQgPSB7XG4gICAgW2h0dHBIYW5kbGVyRm5dOiBmbixcbiAgICBbZXhwb3J0Q29udGV4dF06IGN0eCxcbiAgICBbcmVnaXN0ZXJFeHBvcnRdKGN0eDIsIGV4cG9ydE5hbWUpIHtcbiAgICAgIGlmIChleHBvcnRlZEh0dHBIYW5kbGVyT2JqZWN0cy5oYXMoaGFuZGxlckV4cG9ydCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgICBgSFRUUCBoYW5kbGVyICcke2V4cG9ydE5hbWV9JyB3YXMgZXhwb3J0ZWQgbW9yZSB0aGFuIG9uY2VgXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBleHBvcnRlZEh0dHBIYW5kbGVyT2JqZWN0cy5hZGQoaGFuZGxlckV4cG9ydCk7XG4gICAgICByZWdpc3Rlckh0dHBIYW5kbGVyKGN0eDIsIGV4cG9ydE5hbWUsIGZuLCBvcHRzKTtcbiAgICAgIGN0eDIuaHR0cEhhbmRsZXJFeHBvcnRzLnNldChcbiAgICAgICAgaGFuZGxlckV4cG9ydCxcbiAgICAgICAgZXhwb3J0TmFtZVxuICAgICAgKTtcbiAgICB9XG4gIH07XG4gIHJldHVybiBoYW5kbGVyRXhwb3J0O1xufVxuZnVuY3Rpb24gbWFrZUh0dHBSb3V0ZXJFeHBvcnQoY3R4LCByb3V0ZXIpIHtcbiAgcmV0dXJuIHtcbiAgICBbZXhwb3J0Q29udGV4dF06IGN0eCxcbiAgICBbcmVnaXN0ZXJFeHBvcnRdKGN0eDIpIHtcbiAgICAgIGN0eDIucGVuZGluZ0h0dHBSb3V0ZXMucHVzaCguLi5yb3V0ZXIuaW50b1JvdXRlcygpKTtcbiAgICB9XG4gIH07XG59XG5mdW5jdGlvbiByZWdpc3Rlckh0dHBIYW5kbGVyKGN0eCwgZXhwb3J0TmFtZSwgZm4sIG9wdHMpIHtcbiAgY3R4LmRlZmluZUh0dHBIYW5kbGVyKGV4cG9ydE5hbWUpO1xuICBjdHgubW9kdWxlRGVmLmh0dHBIYW5kbGVycy5wdXNoKHsgc291cmNlTmFtZTogZXhwb3J0TmFtZSB9KTtcbiAgaWYgKG9wdHM/Lm5hbWUgIT0gbnVsbCkge1xuICAgIGN0eC5tb2R1bGVEZWYuZXhwbGljaXROYW1lcy5lbnRyaWVzLnB1c2goe1xuICAgICAgdGFnOiBcIkZ1bmN0aW9uXCIsXG4gICAgICB2YWx1ZToge1xuICAgICAgICBzb3VyY2VOYW1lOiBleHBvcnROYW1lLFxuICAgICAgICBjYW5vbmljYWxOYW1lOiBvcHRzLm5hbWVcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuICBpZiAoIWZuLm5hbWUpIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoZm4sIFwibmFtZVwiLCB7IHZhbHVlOiBleHBvcnROYW1lLCB3cml0YWJsZTogZmFsc2UgfSk7XG4gIH1cbiAgY3R4Lmh0dHBIYW5kbGVycy5wdXNoKGZuKTtcbn1cblxuLy8gc3JjL3NlcnZlci9odHRwX2ludGVybmFsLnRzXG52YXIgaW1wb3J0X3N0YXR1c2VzID0gX190b0VTTShyZXF1aXJlX3N0YXR1c2VzKCkpO1xuXG4vLyBzcmMvc2VydmVyL3JhbmdlLnRzXG52YXIgUmFuZ2UgPSBjbGFzcyB7XG4gICNmcm9tO1xuICAjdG87XG4gIGNvbnN0cnVjdG9yKGZyb20sIHRvKSB7XG4gICAgdGhpcy4jZnJvbSA9IGZyb20gPz8geyB0YWc6IFwidW5ib3VuZGVkXCIgfTtcbiAgICB0aGlzLiN0byA9IHRvID8/IHsgdGFnOiBcInVuYm91bmRlZFwiIH07XG4gIH1cbiAgZ2V0IGZyb20oKSB7XG4gICAgcmV0dXJuIHRoaXMuI2Zyb207XG4gIH1cbiAgZ2V0IHRvKCkge1xuICAgIHJldHVybiB0aGlzLiN0bztcbiAgfVxufTtcblxuLy8gc3JjL2xpYi90YWJsZS50c1xuZnVuY3Rpb24gdGFibGUob3B0cywgcm93LCAuLi5fKSB7XG4gIGNvbnN0IHtcbiAgICBuYW1lLFxuICAgIHB1YmxpYzogaXNQdWJsaWMgPSBmYWxzZSxcbiAgICBpbmRleGVzOiB1c2VySW5kZXhlcyA9IFtdLFxuICAgIHNjaGVkdWxlZCxcbiAgICBldmVudDogaXNFdmVudCA9IGZhbHNlXG4gIH0gPSBvcHRzO1xuICBjb25zdCBjb2xJZHMgPSAvKiBAX19QVVJFX18gKi8gbmV3IE1hcCgpO1xuICBjb25zdCBjb2xOYW1lTGlzdCA9IFtdO1xuICBpZiAoIShyb3cgaW5zdGFuY2VvZiBSb3dCdWlsZGVyKSkge1xuICAgIHJvdyA9IG5ldyBSb3dCdWlsZGVyKHJvdyk7XG4gIH1cbiAgcm93LmFsZ2VicmFpY1R5cGUudmFsdWUuZWxlbWVudHMuZm9yRWFjaCgoZWxlbSwgaSkgPT4ge1xuICAgIGNvbElkcy5zZXQoZWxlbS5uYW1lLCBpKTtcbiAgICBjb2xOYW1lTGlzdC5wdXNoKGVsZW0ubmFtZSk7XG4gIH0pO1xuICBjb25zdCBwayA9IFtdO1xuICBjb25zdCBpbmRleGVzID0gW107XG4gIGNvbnN0IGNvbnN0cmFpbnRzID0gW107XG4gIGNvbnN0IHNlcXVlbmNlcyA9IFtdO1xuICBsZXQgc2NoZWR1bGVBdENvbDtcbiAgY29uc3QgZGVmYXVsdFZhbHVlcyA9IFtdO1xuICBmb3IgKGNvbnN0IFtuYW1lMiwgYnVpbGRlcl0gb2YgT2JqZWN0LmVudHJpZXMocm93LnJvdykpIHtcbiAgICBjb25zdCBtZXRhID0gYnVpbGRlci5jb2x1bW5NZXRhZGF0YTtcbiAgICBpZiAobWV0YS5pc1ByaW1hcnlLZXkpIHtcbiAgICAgIHBrLnB1c2goY29sSWRzLmdldChuYW1lMikpO1xuICAgIH1cbiAgICBjb25zdCBpc1VuaXF1ZSA9IG1ldGEuaXNVbmlxdWUgfHwgbWV0YS5pc1ByaW1hcnlLZXk7XG4gICAgaWYgKG1ldGEuaW5kZXhUeXBlIHx8IGlzVW5pcXVlKSB7XG4gICAgICBjb25zdCBhbGdvID0gbWV0YS5pbmRleFR5cGUgPz8gXCJidHJlZVwiO1xuICAgICAgY29uc3QgaWQgPSBjb2xJZHMuZ2V0KG5hbWUyKTtcbiAgICAgIGxldCBhbGdvcml0aG07XG4gICAgICBzd2l0Y2ggKGFsZ28pIHtcbiAgICAgICAgY2FzZSBcImJ0cmVlXCI6XG4gICAgICAgICAgYWxnb3JpdGhtID0gUmF3SW5kZXhBbGdvcml0aG0uQlRyZWUoW2lkXSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJoYXNoXCI6XG4gICAgICAgICAgYWxnb3JpdGhtID0gUmF3SW5kZXhBbGdvcml0aG0uSGFzaChbaWRdKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImRpcmVjdFwiOlxuICAgICAgICAgIGFsZ29yaXRobSA9IFJhd0luZGV4QWxnb3JpdGhtLkRpcmVjdChpZCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBpbmRleGVzLnB1c2goe1xuICAgICAgICBzb3VyY2VOYW1lOiB2b2lkIDAsXG4gICAgICAgIC8vIFVubmFtZWQgaW5kZXhlcyB3aWxsIGJlIGFzc2lnbmVkIGEgZ2xvYmFsbHkgdW5pcXVlIG5hbWVcbiAgICAgICAgYWNjZXNzb3JOYW1lOiBuYW1lMixcbiAgICAgICAgYWxnb3JpdGhtXG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKGlzVW5pcXVlKSB7XG4gICAgICBjb25zdHJhaW50cy5wdXNoKHtcbiAgICAgICAgc291cmNlTmFtZTogdm9pZCAwLFxuICAgICAgICBkYXRhOiB7IHRhZzogXCJVbmlxdWVcIiwgdmFsdWU6IHsgY29sdW1uczogW2NvbElkcy5nZXQobmFtZTIpXSB9IH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAobWV0YS5pc0F1dG9JbmNyZW1lbnQpIHtcbiAgICAgIHNlcXVlbmNlcy5wdXNoKHtcbiAgICAgICAgc291cmNlTmFtZTogdm9pZCAwLFxuICAgICAgICBzdGFydDogdm9pZCAwLFxuICAgICAgICBtaW5WYWx1ZTogdm9pZCAwLFxuICAgICAgICBtYXhWYWx1ZTogdm9pZCAwLFxuICAgICAgICBjb2x1bW46IGNvbElkcy5nZXQobmFtZTIpLFxuICAgICAgICBpbmNyZW1lbnQ6IDFuXG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChtZXRhLCBcImRlZmF1bHRWYWx1ZVwiKSkge1xuICAgICAgY29uc3Qgd3JpdGVyID0gbmV3IEJpbmFyeVdyaXRlcigxNik7XG4gICAgICBidWlsZGVyLnNlcmlhbGl6ZSh3cml0ZXIsIG1ldGEuZGVmYXVsdFZhbHVlKTtcbiAgICAgIGRlZmF1bHRWYWx1ZXMucHVzaCh7XG4gICAgICAgIGNvbElkOiBjb2xJZHMuZ2V0KG5hbWUyKSxcbiAgICAgICAgdmFsdWU6IHdyaXRlci5nZXRCdWZmZXIoKVxuICAgICAgfSk7XG4gICAgfVxuICAgIGNvbnN0IGFsZ2VicmFpY1R5cGUgPSBidWlsZGVyLnR5cGVCdWlsZGVyLmFsZ2VicmFpY1R5cGU7XG4gICAgaWYgKHNjaGVkdWxlX2F0X2RlZmF1bHQuaXNTY2hlZHVsZUF0KGFsZ2VicmFpY1R5cGUpKSB7XG4gICAgICBzY2hlZHVsZUF0Q29sID0gY29sSWRzLmdldChuYW1lMik7XG4gICAgfVxuICB9XG4gIGZvciAoY29uc3QgaW5kZXhPcHRzIG9mIHVzZXJJbmRleGVzID8/IFtdKSB7XG4gICAgY29uc3QgYWNjZXNzb3IgPSBpbmRleE9wdHMuYWNjZXNzb3I7XG4gICAgaWYgKHR5cGVvZiBhY2Nlc3NvciAhPT0gXCJzdHJpbmdcIiB8fCBhY2Nlc3Nvci5sZW5ndGggPT09IDApIHtcbiAgICAgIGNvbnN0IHRhYmxlTGFiZWwgPSBuYW1lID8/IFwiPHVubmFtZWQ+XCI7XG4gICAgICBjb25zdCBpbmRleExhYmVsID0gaW5kZXhPcHRzLm5hbWUgPz8gXCI8dW5uYW1lZD5cIjtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgIGBJbmRleCAnJHtpbmRleExhYmVsfScgb24gdGFibGUgJyR7dGFibGVMYWJlbH0nIG11c3QgZGVmaW5lIGEgbm9uLWVtcHR5ICdhY2Nlc3NvcidgXG4gICAgICApO1xuICAgIH1cbiAgICBsZXQgYWxnb3JpdGhtO1xuICAgIHN3aXRjaCAoaW5kZXhPcHRzLmFsZ29yaXRobSkge1xuICAgICAgY2FzZSBcImJ0cmVlXCI6XG4gICAgICAgIGFsZ29yaXRobSA9IHtcbiAgICAgICAgICB0YWc6IFwiQlRyZWVcIixcbiAgICAgICAgICB2YWx1ZTogaW5kZXhPcHRzLmNvbHVtbnMubWFwKChjKSA9PiBjb2xJZHMuZ2V0KGMpKVxuICAgICAgICB9O1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJoYXNoXCI6XG4gICAgICAgIGFsZ29yaXRobSA9IHtcbiAgICAgICAgICB0YWc6IFwiSGFzaFwiLFxuICAgICAgICAgIHZhbHVlOiBpbmRleE9wdHMuY29sdW1ucy5tYXAoKGMpID0+IGNvbElkcy5nZXQoYykpXG4gICAgICAgIH07XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcImRpcmVjdFwiOlxuICAgICAgICBhbGdvcml0aG0gPSB7IHRhZzogXCJEaXJlY3RcIiwgdmFsdWU6IGNvbElkcy5nZXQoaW5kZXhPcHRzLmNvbHVtbikgfTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGluZGV4ZXMucHVzaCh7XG4gICAgICBzb3VyY2VOYW1lOiB2b2lkIDAsXG4gICAgICBhY2Nlc3Nvck5hbWU6IGFjY2Vzc29yLFxuICAgICAgYWxnb3JpdGhtLFxuICAgICAgY2Fub25pY2FsTmFtZTogaW5kZXhPcHRzLm5hbWVcbiAgICB9KTtcbiAgfVxuICBmb3IgKGNvbnN0IGNvbnN0cmFpbnRPcHRzIG9mIG9wdHMuY29uc3RyYWludHMgPz8gW10pIHtcbiAgICBpZiAoY29uc3RyYWludE9wdHMuY29uc3RyYWludCA9PT0gXCJ1bmlxdWVcIikge1xuICAgICAgY29uc3QgZGF0YSA9IHtcbiAgICAgICAgdGFnOiBcIlVuaXF1ZVwiLFxuICAgICAgICB2YWx1ZTogeyBjb2x1bW5zOiBjb25zdHJhaW50T3B0cy5jb2x1bW5zLm1hcCgoYykgPT4gY29sSWRzLmdldChjKSkgfVxuICAgICAgfTtcbiAgICAgIGNvbnN0cmFpbnRzLnB1c2goeyBzb3VyY2VOYW1lOiBjb25zdHJhaW50T3B0cy5uYW1lLCBkYXRhIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICB9XG4gIGNvbnN0IHByb2R1Y3RUeXBlID0gcm93LmFsZ2VicmFpY1R5cGUudmFsdWU7XG4gIGNvbnN0IHNjaGVkdWxlID0gc2NoZWR1bGVkICYmIHNjaGVkdWxlQXRDb2wgIT09IHZvaWQgMCA/IHsgc2NoZWR1bGVBdENvbCwgcmVkdWNlcjogc2NoZWR1bGVkIH0gOiB2b2lkIDA7XG4gIHJldHVybiB7XG4gICAgcm93VHlwZTogcm93LFxuICAgIHRhYmxlTmFtZTogbmFtZSxcbiAgICByb3dTcGFjZXRpbWVUeXBlOiBwcm9kdWN0VHlwZSxcbiAgICB0YWJsZURlZjogKGN0eCwgYWNjTmFtZSkgPT4ge1xuICAgICAgY29uc3QgdGFibGVOYW1lID0gbmFtZSA/PyBhY2NOYW1lO1xuICAgICAgaWYgKHJvdy50eXBlTmFtZSA9PT0gdm9pZCAwKSB7XG4gICAgICAgIHJvdy50eXBlTmFtZSA9IHRvUGFzY2FsQ2FzZSh0YWJsZU5hbWUpO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBpbmRleCBvZiBpbmRleGVzKSB7XG4gICAgICAgIGNvbnN0IGNvbHMgPSBpbmRleC5hbGdvcml0aG0udGFnID09PSBcIkRpcmVjdFwiID8gW2luZGV4LmFsZ29yaXRobS52YWx1ZV0gOiBpbmRleC5hbGdvcml0aG0udmFsdWU7XG4gICAgICAgIGNvbnN0IGNvbFMgPSBjb2xzLm1hcCgoaSkgPT4gY29sTmFtZUxpc3RbaV0pLmpvaW4oXCJfXCIpO1xuICAgICAgICBjb25zdCBzb3VyY2VOYW1lID0gaW5kZXguc291cmNlTmFtZSA9IGAke2FjY05hbWV9XyR7Y29sU31faWR4XyR7aW5kZXguYWxnb3JpdGhtLnRhZy50b0xvd2VyQ2FzZSgpfWA7XG4gICAgICAgIGNvbnN0IHsgY2Fub25pY2FsTmFtZSB9ID0gaW5kZXg7XG4gICAgICAgIGlmIChjYW5vbmljYWxOYW1lICE9PSB2b2lkIDApIHtcbiAgICAgICAgICBjdHgubW9kdWxlRGVmLmV4cGxpY2l0TmFtZXMuZW50cmllcy5wdXNoKFxuICAgICAgICAgICAgRXhwbGljaXROYW1lRW50cnkuSW5kZXgoeyBzb3VyY2VOYW1lLCBjYW5vbmljYWxOYW1lIH0pXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc291cmNlTmFtZTogYWNjTmFtZSxcbiAgICAgICAgcHJvZHVjdFR5cGVSZWY6IGN0eC5yZWdpc3RlclR5cGVzUmVjdXJzaXZlbHkocm93KS5yZWYsXG4gICAgICAgIHByaW1hcnlLZXk6IHBrLFxuICAgICAgICBpbmRleGVzLFxuICAgICAgICBjb25zdHJhaW50cyxcbiAgICAgICAgc2VxdWVuY2VzLFxuICAgICAgICB0YWJsZVR5cGU6IHsgdGFnOiBcIlVzZXJcIiB9LFxuICAgICAgICB0YWJsZUFjY2VzczogeyB0YWc6IGlzUHVibGljID8gXCJQdWJsaWNcIiA6IFwiUHJpdmF0ZVwiIH0sXG4gICAgICAgIGRlZmF1bHRWYWx1ZXMsXG4gICAgICAgIGlzRXZlbnRcbiAgICAgIH07XG4gICAgfSxcbiAgICAvLyBQcmVzZXJ2ZSB0aGUgZGVjbGFyZWQgaW5kZXggb3B0aW9ucyBhcyBydW50aW1lIGRhdGEgc28gYHRhYmxlVG9TY2hlbWFgXG4gICAgLy8gY2FuIGV4cG9zZSB0aGVtIHdpdGhvdXQgdHlwZS1zbXVnZ2xpbmcuXG4gICAgaWR4czogdXNlckluZGV4ZXMsXG4gICAgY29uc3RyYWludHMsXG4gICAgc2NoZWR1bGVBdENvbCxcbiAgICBzY2hlZHVsZVxuICB9O1xufVxuXG4vLyBzcmMvbGliL3F1ZXJ5LnRzXG52YXIgUXVlcnlCcmFuZCA9IFN5bWJvbChcIlF1ZXJ5QnJhbmRcIik7XG52YXIgaXNSb3dUeXBlZFF1ZXJ5ID0gKHZhbCkgPT4gISF2YWwgJiYgdHlwZW9mIHZhbCA9PT0gXCJvYmplY3RcIiAmJiBRdWVyeUJyYW5kIGluIHZhbDtcbnZhciBpc1R5cGVkUXVlcnkgPSAodmFsKSA9PiAhIXZhbCAmJiB0eXBlb2YgdmFsID09PSBcIm9iamVjdFwiICYmIFF1ZXJ5QnJhbmQgaW4gdmFsO1xuZnVuY3Rpb24gdG9TcWwocSkge1xuICByZXR1cm4gcS50b1NxbCgpO1xufVxudmFyIFNlbWlqb2luSW1wbCA9IGNsYXNzIF9TZW1pam9pbkltcGwge1xuICBjb25zdHJ1Y3Rvcihzb3VyY2VRdWVyeSwgZmlsdGVyUXVlcnksIGpvaW5Db25kaXRpb24pIHtcbiAgICB0aGlzLnNvdXJjZVF1ZXJ5ID0gc291cmNlUXVlcnk7XG4gICAgdGhpcy5maWx0ZXJRdWVyeSA9IGZpbHRlclF1ZXJ5O1xuICAgIHRoaXMuam9pbkNvbmRpdGlvbiA9IGpvaW5Db25kaXRpb247XG4gICAgaWYgKHNvdXJjZVF1ZXJ5LnRhYmxlLnNvdXJjZU5hbWUgPT09IGZpbHRlclF1ZXJ5LnRhYmxlLnNvdXJjZU5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBzZW1pam9pbiBhIHRhYmxlIHRvIGl0c2VsZlwiKTtcbiAgICB9XG4gIH1cbiAgW1F1ZXJ5QnJhbmRdID0gdHJ1ZTtcbiAgdHlwZSA9IFwic2VtaWpvaW5cIjtcbiAgYnVpbGQoKSB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgd2hlcmUocHJlZGljYXRlKSB7XG4gICAgY29uc3QgbmV4dFNvdXJjZVF1ZXJ5ID0gdGhpcy5zb3VyY2VRdWVyeS53aGVyZShwcmVkaWNhdGUpO1xuICAgIHJldHVybiBuZXcgX1NlbWlqb2luSW1wbChcbiAgICAgIG5leHRTb3VyY2VRdWVyeSxcbiAgICAgIHRoaXMuZmlsdGVyUXVlcnksXG4gICAgICB0aGlzLmpvaW5Db25kaXRpb25cbiAgICApO1xuICB9XG4gIHRvU3FsKCkge1xuICAgIGNvbnN0IGxlZnQgPSB0aGlzLmZpbHRlclF1ZXJ5O1xuICAgIGNvbnN0IHJpZ2h0ID0gdGhpcy5zb3VyY2VRdWVyeTtcbiAgICBjb25zdCBsZWZ0VGFibGUgPSBxdW90ZUlkZW50aWZpZXIobGVmdC50YWJsZS5zb3VyY2VOYW1lKTtcbiAgICBjb25zdCByaWdodFRhYmxlID0gcXVvdGVJZGVudGlmaWVyKHJpZ2h0LnRhYmxlLnNvdXJjZU5hbWUpO1xuICAgIGxldCBzcWwgPSBgU0VMRUNUICR7cmlnaHRUYWJsZX0uKiBGUk9NICR7bGVmdFRhYmxlfSBKT0lOICR7cmlnaHRUYWJsZX0gT04gJHtib29sZWFuRXhwclRvU3FsKHRoaXMuam9pbkNvbmRpdGlvbil9YDtcbiAgICBjb25zdCBjbGF1c2VzID0gW107XG4gICAgaWYgKGxlZnQud2hlcmVDbGF1c2UpIHtcbiAgICAgIGNsYXVzZXMucHVzaChib29sZWFuRXhwclRvU3FsKGxlZnQud2hlcmVDbGF1c2UpKTtcbiAgICB9XG4gICAgaWYgKHJpZ2h0LndoZXJlQ2xhdXNlKSB7XG4gICAgICBjbGF1c2VzLnB1c2goYm9vbGVhbkV4cHJUb1NxbChyaWdodC53aGVyZUNsYXVzZSkpO1xuICAgIH1cbiAgICBpZiAoY2xhdXNlcy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCB3aGVyZVNxbCA9IGNsYXVzZXMubGVuZ3RoID09PSAxID8gY2xhdXNlc1swXSA6IGNsYXVzZXMubWFwKHdyYXBJblBhcmVucykuam9pbihcIiBBTkQgXCIpO1xuICAgICAgc3FsICs9IGAgV0hFUkUgJHt3aGVyZVNxbH1gO1xuICAgIH1cbiAgICByZXR1cm4gc3FsO1xuICB9XG59O1xudmFyIEZyb21CdWlsZGVyID0gY2xhc3MgX0Zyb21CdWlsZGVyIHtcbiAgY29uc3RydWN0b3IodGFibGUyLCB3aGVyZUNsYXVzZSkge1xuICAgIHRoaXMudGFibGUgPSB0YWJsZTI7XG4gICAgdGhpcy53aGVyZUNsYXVzZSA9IHdoZXJlQ2xhdXNlO1xuICB9XG4gIFtRdWVyeUJyYW5kXSA9IHRydWU7XG4gIHdoZXJlKHByZWRpY2F0ZSkge1xuICAgIGNvbnN0IG5ld0NvbmRpdGlvbiA9IG5vcm1hbGl6ZVByZWRpY2F0ZUV4cHIocHJlZGljYXRlKHRoaXMudGFibGUuY29scykpO1xuICAgIGNvbnN0IG5leHRXaGVyZSA9IHRoaXMud2hlcmVDbGF1c2UgPyB0aGlzLndoZXJlQ2xhdXNlLmFuZChuZXdDb25kaXRpb24pIDogbmV3Q29uZGl0aW9uO1xuICAgIHJldHVybiBuZXcgX0Zyb21CdWlsZGVyKHRoaXMudGFibGUsIG5leHRXaGVyZSk7XG4gIH1cbiAgcmlnaHRTZW1pam9pbihyaWdodCwgb24pIHtcbiAgICBjb25zdCBzb3VyY2VRdWVyeSA9IG5ldyBfRnJvbUJ1aWxkZXIocmlnaHQpO1xuICAgIGNvbnN0IGpvaW5Db25kaXRpb24gPSBvbihcbiAgICAgIHRoaXMudGFibGUuaW5kZXhlZENvbHMsXG4gICAgICByaWdodC5pbmRleGVkQ29sc1xuICAgICk7XG4gICAgcmV0dXJuIG5ldyBTZW1pam9pbkltcGwoc291cmNlUXVlcnksIHRoaXMsIGpvaW5Db25kaXRpb24pO1xuICB9XG4gIGxlZnRTZW1pam9pbihyaWdodCwgb24pIHtcbiAgICBjb25zdCBmaWx0ZXJRdWVyeSA9IG5ldyBfRnJvbUJ1aWxkZXIocmlnaHQpO1xuICAgIGNvbnN0IGpvaW5Db25kaXRpb24gPSBvbihcbiAgICAgIHRoaXMudGFibGUuaW5kZXhlZENvbHMsXG4gICAgICByaWdodC5pbmRleGVkQ29sc1xuICAgICk7XG4gICAgcmV0dXJuIG5ldyBTZW1pam9pbkltcGwodGhpcywgZmlsdGVyUXVlcnksIGpvaW5Db25kaXRpb24pO1xuICB9XG4gIHRvU3FsKCkge1xuICAgIHJldHVybiByZW5kZXJTZWxlY3RTcWxXaXRoSm9pbnModGhpcy50YWJsZSwgdGhpcy53aGVyZUNsYXVzZSk7XG4gIH1cbiAgYnVpbGQoKSB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbn07XG52YXIgVGFibGVSZWZJbXBsID0gY2xhc3Mge1xuICBbUXVlcnlCcmFuZF0gPSB0cnVlO1xuICB0eXBlID0gXCJ0YWJsZVwiO1xuICBzb3VyY2VOYW1lO1xuICBhY2Nlc3Nvck5hbWU7XG4gIGNvbHM7XG4gIGluZGV4ZWRDb2xzO1xuICB0YWJsZURlZjtcbiAgLy8gRGVsZWdhdGUgVW50eXBlZFRhYmxlRGVmIHByb3BlcnRpZXMgZnJvbSB0YWJsZURlZiBzbyB0aGlzIGNhbiBiZSB1c2VkIGFzIGEgdGFibGUgZGVmLlxuICBnZXQgY29sdW1ucygpIHtcbiAgICByZXR1cm4gdGhpcy50YWJsZURlZi5jb2x1bW5zO1xuICB9XG4gIGdldCBpbmRleGVzKCkge1xuICAgIHJldHVybiB0aGlzLnRhYmxlRGVmLmluZGV4ZXM7XG4gIH1cbiAgZ2V0IHJvd1R5cGUoKSB7XG4gICAgcmV0dXJuIHRoaXMudGFibGVEZWYucm93VHlwZTtcbiAgfVxuICBnZXQgY29uc3RyYWludHMoKSB7XG4gICAgcmV0dXJuIHRoaXMudGFibGVEZWYuY29uc3RyYWludHM7XG4gIH1cbiAgY29uc3RydWN0b3IodGFibGVEZWYpIHtcbiAgICB0aGlzLnNvdXJjZU5hbWUgPSB0YWJsZURlZi5zb3VyY2VOYW1lO1xuICAgIHRoaXMuYWNjZXNzb3JOYW1lID0gdGFibGVEZWYuYWNjZXNzb3JOYW1lO1xuICAgIHRoaXMuY29scyA9IGNyZWF0ZVJvd0V4cHIodGFibGVEZWYpO1xuICAgIHRoaXMuaW5kZXhlZENvbHMgPSB0aGlzLmNvbHM7XG4gICAgdGhpcy50YWJsZURlZiA9IHRhYmxlRGVmO1xuICAgIE9iamVjdC5mcmVlemUodGhpcyk7XG4gIH1cbiAgYXNGcm9tKCkge1xuICAgIHJldHVybiBuZXcgRnJvbUJ1aWxkZXIodGhpcyk7XG4gIH1cbiAgcmlnaHRTZW1pam9pbihvdGhlciwgb24pIHtcbiAgICByZXR1cm4gdGhpcy5hc0Zyb20oKS5yaWdodFNlbWlqb2luKG90aGVyLCBvbik7XG4gIH1cbiAgbGVmdFNlbWlqb2luKG90aGVyLCBvbikge1xuICAgIHJldHVybiB0aGlzLmFzRnJvbSgpLmxlZnRTZW1pam9pbihvdGhlciwgb24pO1xuICB9XG4gIGJ1aWxkKCkge1xuICAgIHJldHVybiB0aGlzLmFzRnJvbSgpLmJ1aWxkKCk7XG4gIH1cbiAgdG9TcWwoKSB7XG4gICAgcmV0dXJuIHRoaXMuYXNGcm9tKCkudG9TcWwoKTtcbiAgfVxuICB3aGVyZShwcmVkaWNhdGUpIHtcbiAgICByZXR1cm4gdGhpcy5hc0Zyb20oKS53aGVyZShwcmVkaWNhdGUpO1xuICB9XG59O1xuZnVuY3Rpb24gY3JlYXRlVGFibGVSZWZGcm9tRGVmKHRhYmxlRGVmKSB7XG4gIHJldHVybiBuZXcgVGFibGVSZWZJbXBsKHRhYmxlRGVmKTtcbn1cbmZ1bmN0aW9uIG1ha2VRdWVyeUJ1aWxkZXIoc2NoZW1hMikge1xuICBjb25zdCBxYiA9IC8qIEBfX1BVUkVfXyAqLyBPYmplY3QuY3JlYXRlKG51bGwpO1xuICBmb3IgKGNvbnN0IHRhYmxlMiBvZiBPYmplY3QudmFsdWVzKHNjaGVtYTIudGFibGVzKSkge1xuICAgIGNvbnN0IHJlZiA9IGNyZWF0ZVRhYmxlUmVmRnJvbURlZihcbiAgICAgIHRhYmxlMlxuICAgICk7XG4gICAgcWJbdGFibGUyLmFjY2Vzc29yTmFtZV0gPSByZWY7XG4gIH1cbiAgcmV0dXJuIE9iamVjdC5mcmVlemUocWIpO1xufVxuZnVuY3Rpb24gY3JlYXRlUm93RXhwcih0YWJsZURlZikge1xuICBjb25zdCByb3cgPSB7fTtcbiAgZm9yIChjb25zdCBjb2x1bW5OYW1lIG9mIE9iamVjdC5rZXlzKHRhYmxlRGVmLmNvbHVtbnMpKSB7XG4gICAgY29uc3QgY29sdW1uQnVpbGRlciA9IHRhYmxlRGVmLmNvbHVtbnNbY29sdW1uTmFtZV07XG4gICAgY29uc3QgY29sdW1uID0gbmV3IENvbHVtbkV4cHJlc3Npb24oXG4gICAgICB0YWJsZURlZi5zb3VyY2VOYW1lLFxuICAgICAgY29sdW1uTmFtZSxcbiAgICAgIGNvbHVtbkJ1aWxkZXIudHlwZUJ1aWxkZXIuYWxnZWJyYWljVHlwZSxcbiAgICAgIGNvbHVtbkJ1aWxkZXIuY29sdW1uTWV0YWRhdGEubmFtZVxuICAgICk7XG4gICAgcm93W2NvbHVtbk5hbWVdID0gT2JqZWN0LmZyZWV6ZShjb2x1bW4pO1xuICB9XG4gIHJldHVybiBPYmplY3QuZnJlZXplKHJvdyk7XG59XG5mdW5jdGlvbiByZW5kZXJTZWxlY3RTcWxXaXRoSm9pbnModGFibGUyLCB3aGVyZSwgZXh0cmFDbGF1c2VzID0gW10pIHtcbiAgY29uc3QgcXVvdGVkVGFibGUgPSBxdW90ZUlkZW50aWZpZXIodGFibGUyLnNvdXJjZU5hbWUpO1xuICBjb25zdCBzcWwgPSBgU0VMRUNUICogRlJPTSAke3F1b3RlZFRhYmxlfWA7XG4gIGNvbnN0IGNsYXVzZXMgPSBbXTtcbiAgaWYgKHdoZXJlKSBjbGF1c2VzLnB1c2goYm9vbGVhbkV4cHJUb1NxbCh3aGVyZSkpO1xuICBjbGF1c2VzLnB1c2goLi4uZXh0cmFDbGF1c2VzKTtcbiAgaWYgKGNsYXVzZXMubGVuZ3RoID09PSAwKSByZXR1cm4gc3FsO1xuICBjb25zdCB3aGVyZVNxbCA9IGNsYXVzZXMubGVuZ3RoID09PSAxID8gY2xhdXNlc1swXSA6IGNsYXVzZXMubWFwKHdyYXBJblBhcmVucykuam9pbihcIiBBTkQgXCIpO1xuICByZXR1cm4gYCR7c3FsfSBXSEVSRSAke3doZXJlU3FsfWA7XG59XG52YXIgQ29sdW1uRXhwcmVzc2lvbiA9IGNsYXNzIHtcbiAgdHlwZSA9IFwiY29sdW1uXCI7XG4gIC8vIFRoaXMgaXMgdGhlIGNvbHVtbiBhY2Nlc3NvclxuICBjb2x1bW47XG4gIC8vIFRoZSBuYW1lIG9mIHRoZSBjb2x1bW4gaW4gdGhlIGRhdGFiYXNlLlxuICBjb2x1bW5OYW1lO1xuICB0YWJsZTtcbiAgLy8gcGhhbnRvbTogYWN0dWFsIHJ1bnRpbWUgdmFsdWUgaXMgdW5kZWZpbmVkXG4gIHRzVmFsdWVUeXBlO1xuICBzcGFjZXRpbWVUeXBlO1xuICBjb25zdHJ1Y3Rvcih0YWJsZTIsIGNvbHVtbiwgc3BhY2V0aW1lVHlwZSwgY29sdW1uTmFtZSkge1xuICAgIHRoaXMudGFibGUgPSB0YWJsZTI7XG4gICAgdGhpcy5jb2x1bW4gPSBjb2x1bW47XG4gICAgdGhpcy5jb2x1bW5OYW1lID0gY29sdW1uTmFtZSB8fCBjb2x1bW47XG4gICAgdGhpcy5zcGFjZXRpbWVUeXBlID0gc3BhY2V0aW1lVHlwZTtcbiAgfVxuICBlcSh4KSB7XG4gICAgcmV0dXJuIG5ldyBCb29sZWFuRXhwcih7XG4gICAgICB0eXBlOiBcImVxXCIsXG4gICAgICBsZWZ0OiB0aGlzLFxuICAgICAgcmlnaHQ6IG5vcm1hbGl6ZVZhbHVlKHgpXG4gICAgfSk7XG4gIH1cbiAgbmUoeCkge1xuICAgIHJldHVybiBuZXcgQm9vbGVhbkV4cHIoe1xuICAgICAgdHlwZTogXCJuZVwiLFxuICAgICAgbGVmdDogdGhpcyxcbiAgICAgIHJpZ2h0OiBub3JtYWxpemVWYWx1ZSh4KVxuICAgIH0pO1xuICB9XG4gIGx0KHgpIHtcbiAgICByZXR1cm4gbmV3IEJvb2xlYW5FeHByKHtcbiAgICAgIHR5cGU6IFwibHRcIixcbiAgICAgIGxlZnQ6IHRoaXMsXG4gICAgICByaWdodDogbm9ybWFsaXplVmFsdWUoeClcbiAgICB9KTtcbiAgfVxuICBsdGUoeCkge1xuICAgIHJldHVybiBuZXcgQm9vbGVhbkV4cHIoe1xuICAgICAgdHlwZTogXCJsdGVcIixcbiAgICAgIGxlZnQ6IHRoaXMsXG4gICAgICByaWdodDogbm9ybWFsaXplVmFsdWUoeClcbiAgICB9KTtcbiAgfVxuICBndCh4KSB7XG4gICAgcmV0dXJuIG5ldyBCb29sZWFuRXhwcih7XG4gICAgICB0eXBlOiBcImd0XCIsXG4gICAgICBsZWZ0OiB0aGlzLFxuICAgICAgcmlnaHQ6IG5vcm1hbGl6ZVZhbHVlKHgpXG4gICAgfSk7XG4gIH1cbiAgZ3RlKHgpIHtcbiAgICByZXR1cm4gbmV3IEJvb2xlYW5FeHByKHtcbiAgICAgIHR5cGU6IFwiZ3RlXCIsXG4gICAgICBsZWZ0OiB0aGlzLFxuICAgICAgcmlnaHQ6IG5vcm1hbGl6ZVZhbHVlKHgpXG4gICAgfSk7XG4gIH1cbn07XG5mdW5jdGlvbiBsaXRlcmFsKHZhbHVlKSB7XG4gIHJldHVybiB7IHR5cGU6IFwibGl0ZXJhbFwiLCB2YWx1ZSB9O1xufVxuZnVuY3Rpb24gbm9ybWFsaXplVmFsdWUodmFsKSB7XG4gIGlmICh2YWwudHlwZSA9PT0gXCJsaXRlcmFsXCIpXG4gICAgcmV0dXJuIHZhbDtcbiAgaWYgKHR5cGVvZiB2YWwgPT09IFwib2JqZWN0XCIgJiYgdmFsICE9IG51bGwgJiYgXCJ0eXBlXCIgaW4gdmFsICYmIHZhbC50eXBlID09PSBcImNvbHVtblwiKSB7XG4gICAgcmV0dXJuIHZhbDtcbiAgfVxuICByZXR1cm4gbGl0ZXJhbCh2YWwpO1xufVxuZnVuY3Rpb24gbm9ybWFsaXplUHJlZGljYXRlRXhwcih2YWx1ZSkge1xuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBCb29sZWFuRXhwcikgcmV0dXJuIHZhbHVlO1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcImJvb2xlYW5cIikge1xuICAgIHJldHVybiBuZXcgQm9vbGVhbkV4cHIoe1xuICAgICAgdHlwZTogXCJlcVwiLFxuICAgICAgbGVmdDogbGl0ZXJhbCh2YWx1ZSksXG4gICAgICByaWdodDogbGl0ZXJhbCh0cnVlKVxuICAgIH0pO1xuICB9XG4gIHJldHVybiBuZXcgQm9vbGVhbkV4cHIoe1xuICAgIHR5cGU6IFwiZXFcIixcbiAgICBsZWZ0OiB2YWx1ZSxcbiAgICByaWdodDogbGl0ZXJhbCh0cnVlKVxuICB9KTtcbn1cbnZhciBCb29sZWFuRXhwciA9IGNsYXNzIF9Cb29sZWFuRXhwciB7XG4gIGNvbnN0cnVjdG9yKGRhdGEpIHtcbiAgICB0aGlzLmRhdGEgPSBkYXRhO1xuICB9XG4gIGFuZChvdGhlcikge1xuICAgIHJldHVybiBuZXcgX0Jvb2xlYW5FeHByKHtcbiAgICAgIHR5cGU6IFwiYW5kXCIsXG4gICAgICBjbGF1c2VzOiBbdGhpcy5kYXRhLCBvdGhlci5kYXRhXVxuICAgIH0pO1xuICB9XG4gIG9yKG90aGVyKSB7XG4gICAgcmV0dXJuIG5ldyBfQm9vbGVhbkV4cHIoe1xuICAgICAgdHlwZTogXCJvclwiLFxuICAgICAgY2xhdXNlczogW3RoaXMuZGF0YSwgb3RoZXIuZGF0YV1cbiAgICB9KTtcbiAgfVxuICBub3QoKSB7XG4gICAgcmV0dXJuIG5ldyBfQm9vbGVhbkV4cHIoeyB0eXBlOiBcIm5vdFwiLCBjbGF1c2U6IHRoaXMuZGF0YSB9KTtcbiAgfVxufTtcbmZ1bmN0aW9uIG5vdChjbGF1c2UpIHtcbiAgcmV0dXJuIG5ldyBCb29sZWFuRXhwcih7IHR5cGU6IFwibm90XCIsIGNsYXVzZTogY2xhdXNlLmRhdGEgfSk7XG59XG5mdW5jdGlvbiBhbmQoZmlyc3QsIHNlY29uZCwgLi4ucmVzdCkge1xuICBjb25zdCBjbGF1c2VzID0gW2ZpcnN0LCBzZWNvbmQsIC4uLnJlc3RdO1xuICByZXR1cm4gbmV3IEJvb2xlYW5FeHByKHtcbiAgICB0eXBlOiBcImFuZFwiLFxuICAgIGNsYXVzZXM6IGNsYXVzZXMubWFwKChjKSA9PiBjLmRhdGEpXG4gIH0pO1xufVxuZnVuY3Rpb24gb3IoZmlyc3QsIHNlY29uZCwgLi4ucmVzdCkge1xuICBjb25zdCBjbGF1c2VzID0gW2ZpcnN0LCBzZWNvbmQsIC4uLnJlc3RdO1xuICByZXR1cm4gbmV3IEJvb2xlYW5FeHByKHtcbiAgICB0eXBlOiBcIm9yXCIsXG4gICAgY2xhdXNlczogY2xhdXNlcy5tYXAoKGMpID0+IGMuZGF0YSlcbiAgfSk7XG59XG5mdW5jdGlvbiBib29sZWFuRXhwclRvU3FsKGV4cHIsIHRhYmxlQWxpYXMpIHtcbiAgY29uc3QgZGF0YSA9IGV4cHIgaW5zdGFuY2VvZiBCb29sZWFuRXhwciA/IGV4cHIuZGF0YSA6IGV4cHI7XG4gIHN3aXRjaCAoZGF0YS50eXBlKSB7XG4gICAgY2FzZSBcImVxXCI6XG4gICAgICByZXR1cm4gYCR7dmFsdWVFeHByVG9TcWwoZGF0YS5sZWZ0KX0gPSAke3ZhbHVlRXhwclRvU3FsKGRhdGEucmlnaHQpfWA7XG4gICAgY2FzZSBcIm5lXCI6XG4gICAgICByZXR1cm4gYCR7dmFsdWVFeHByVG9TcWwoZGF0YS5sZWZ0KX0gPD4gJHt2YWx1ZUV4cHJUb1NxbChkYXRhLnJpZ2h0KX1gO1xuICAgIGNhc2UgXCJndFwiOlxuICAgICAgcmV0dXJuIGAke3ZhbHVlRXhwclRvU3FsKGRhdGEubGVmdCl9ID4gJHt2YWx1ZUV4cHJUb1NxbChkYXRhLnJpZ2h0KX1gO1xuICAgIGNhc2UgXCJndGVcIjpcbiAgICAgIHJldHVybiBgJHt2YWx1ZUV4cHJUb1NxbChkYXRhLmxlZnQpfSA+PSAke3ZhbHVlRXhwclRvU3FsKGRhdGEucmlnaHQpfWA7XG4gICAgY2FzZSBcImx0XCI6XG4gICAgICByZXR1cm4gYCR7dmFsdWVFeHByVG9TcWwoZGF0YS5sZWZ0KX0gPCAke3ZhbHVlRXhwclRvU3FsKGRhdGEucmlnaHQpfWA7XG4gICAgY2FzZSBcImx0ZVwiOlxuICAgICAgcmV0dXJuIGAke3ZhbHVlRXhwclRvU3FsKGRhdGEubGVmdCl9IDw9ICR7dmFsdWVFeHByVG9TcWwoZGF0YS5yaWdodCl9YDtcbiAgICBjYXNlIFwiYW5kXCI6XG4gICAgICByZXR1cm4gZGF0YS5jbGF1c2VzLm1hcCgoYykgPT4gYm9vbGVhbkV4cHJUb1NxbChjKSkubWFwKHdyYXBJblBhcmVucykuam9pbihcIiBBTkQgXCIpO1xuICAgIGNhc2UgXCJvclwiOlxuICAgICAgcmV0dXJuIGRhdGEuY2xhdXNlcy5tYXAoKGMpID0+IGJvb2xlYW5FeHByVG9TcWwoYykpLm1hcCh3cmFwSW5QYXJlbnMpLmpvaW4oXCIgT1IgXCIpO1xuICAgIGNhc2UgXCJub3RcIjpcbiAgICAgIHJldHVybiBgTk9UICR7d3JhcEluUGFyZW5zKGJvb2xlYW5FeHByVG9TcWwoZGF0YS5jbGF1c2UpKX1gO1xuICB9XG59XG5mdW5jdGlvbiB3cmFwSW5QYXJlbnMoc3FsKSB7XG4gIHJldHVybiBgKCR7c3FsfSlgO1xufVxuZnVuY3Rpb24gdmFsdWVFeHByVG9TcWwoZXhwciwgdGFibGVBbGlhcykge1xuICBpZiAoaXNMaXRlcmFsRXhwcihleHByKSkge1xuICAgIHJldHVybiBsaXRlcmFsVmFsdWVUb1NxbChleHByLnZhbHVlKTtcbiAgfVxuICBjb25zdCB0YWJsZTIgPSBleHByLnRhYmxlO1xuICByZXR1cm4gYCR7cXVvdGVJZGVudGlmaWVyKHRhYmxlMil9LiR7cXVvdGVJZGVudGlmaWVyKGV4cHIuY29sdW1uTmFtZSl9YDtcbn1cbmZ1bmN0aW9uIGxpdGVyYWxWYWx1ZVRvU3FsKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdm9pZCAwKSB7XG4gICAgcmV0dXJuIFwiTlVMTFwiO1xuICB9XG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIElkZW50aXR5IHx8IHZhbHVlIGluc3RhbmNlb2YgQ29ubmVjdGlvbklkIHx8IHZhbHVlIGluc3RhbmNlb2YgVXVpZCkge1xuICAgIHJldHVybiBgMHgke3ZhbHVlLnRvSGV4U3RyaW5nKCl9YDtcbiAgfVxuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBUaW1lc3RhbXApIHtcbiAgICByZXR1cm4gYCcke3ZhbHVlLnRvSVNPU3RyaW5nKCl9J2A7XG4gIH1cbiAgc3dpdGNoICh0eXBlb2YgdmFsdWUpIHtcbiAgICBjYXNlIFwibnVtYmVyXCI6XG4gICAgY2FzZSBcImJpZ2ludFwiOlxuICAgICAgcmV0dXJuIFN0cmluZyh2YWx1ZSk7XG4gICAgY2FzZSBcImJvb2xlYW5cIjpcbiAgICAgIHJldHVybiB2YWx1ZSA/IFwiVFJVRVwiIDogXCJGQUxTRVwiO1xuICAgIGNhc2UgXCJzdHJpbmdcIjpcbiAgICAgIHJldHVybiBgJyR7dmFsdWUucmVwbGFjZSgvJy9nLCBcIicnXCIpfSdgO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gYCcke0pTT04uc3RyaW5naWZ5KHZhbHVlKS5yZXBsYWNlKC8nL2csIFwiJydcIil9J2A7XG4gIH1cbn1cbmZ1bmN0aW9uIHF1b3RlSWRlbnRpZmllcihuYW1lKSB7XG4gIHJldHVybiBgXCIke25hbWUucmVwbGFjZSgvXCIvZywgJ1wiXCInKX1cImA7XG59XG5mdW5jdGlvbiBpc0xpdGVyYWxFeHByKGV4cHIpIHtcbiAgcmV0dXJuIGV4cHIudHlwZSA9PT0gXCJsaXRlcmFsXCI7XG59XG5mdW5jdGlvbiBldmFsdWF0ZUJvb2xlYW5FeHByKGV4cHIsIHJvdykge1xuICByZXR1cm4gZXZhbHVhdGVEYXRhKGV4cHIuZGF0YSwgcm93KTtcbn1cbmZ1bmN0aW9uIGV2YWx1YXRlRGF0YShkYXRhLCByb3cpIHtcbiAgc3dpdGNoIChkYXRhLnR5cGUpIHtcbiAgICBjYXNlIFwiZXFcIjpcbiAgICAgIHJldHVybiByZXNvbHZlVmFsdWUoZGF0YS5sZWZ0LCByb3cpID09PSByZXNvbHZlVmFsdWUoZGF0YS5yaWdodCwgcm93KTtcbiAgICBjYXNlIFwibmVcIjpcbiAgICAgIHJldHVybiByZXNvbHZlVmFsdWUoZGF0YS5sZWZ0LCByb3cpICE9PSByZXNvbHZlVmFsdWUoZGF0YS5yaWdodCwgcm93KTtcbiAgICBjYXNlIFwiZ3RcIjpcbiAgICAgIHJldHVybiByZXNvbHZlVmFsdWUoZGF0YS5sZWZ0LCByb3cpID4gcmVzb2x2ZVZhbHVlKGRhdGEucmlnaHQsIHJvdyk7XG4gICAgY2FzZSBcImd0ZVwiOlxuICAgICAgcmV0dXJuIHJlc29sdmVWYWx1ZShkYXRhLmxlZnQsIHJvdykgPj0gcmVzb2x2ZVZhbHVlKGRhdGEucmlnaHQsIHJvdyk7XG4gICAgY2FzZSBcImx0XCI6XG4gICAgICByZXR1cm4gcmVzb2x2ZVZhbHVlKGRhdGEubGVmdCwgcm93KSA8IHJlc29sdmVWYWx1ZShkYXRhLnJpZ2h0LCByb3cpO1xuICAgIGNhc2UgXCJsdGVcIjpcbiAgICAgIHJldHVybiByZXNvbHZlVmFsdWUoZGF0YS5sZWZ0LCByb3cpIDw9IHJlc29sdmVWYWx1ZShkYXRhLnJpZ2h0LCByb3cpO1xuICAgIGNhc2UgXCJhbmRcIjpcbiAgICAgIHJldHVybiBkYXRhLmNsYXVzZXMuZXZlcnkoKGMpID0+IGV2YWx1YXRlRGF0YShjLCByb3cpKTtcbiAgICBjYXNlIFwib3JcIjpcbiAgICAgIHJldHVybiBkYXRhLmNsYXVzZXMuc29tZSgoYykgPT4gZXZhbHVhdGVEYXRhKGMsIHJvdykpO1xuICAgIGNhc2UgXCJub3RcIjpcbiAgICAgIHJldHVybiAhZXZhbHVhdGVEYXRhKGRhdGEuY2xhdXNlLCByb3cpO1xuICB9XG59XG5mdW5jdGlvbiByZXNvbHZlVmFsdWUoZXhwciwgcm93KSB7XG4gIGlmIChpc0xpdGVyYWxFeHByKGV4cHIpKSB7XG4gICAgcmV0dXJuIHRvQ29tcGFyYWJsZVZhbHVlKGV4cHIudmFsdWUpO1xuICB9XG4gIHJldHVybiB0b0NvbXBhcmFibGVWYWx1ZShyb3dbZXhwci5jb2x1bW5dKTtcbn1cbmZ1bmN0aW9uIGlzSGV4U2VyaWFsaXphYmxlTGlrZSh2YWx1ZSkge1xuICByZXR1cm4gISF2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHZhbHVlLnRvSGV4U3RyaW5nID09PSBcImZ1bmN0aW9uXCI7XG59XG5mdW5jdGlvbiBpc1RpbWVzdGFtcExpa2UodmFsdWUpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZTtcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgVGltZXN0YW1wKSByZXR1cm4gdHJ1ZTtcbiAgY29uc3QgbWljcm9zID0gdmFsdWVbXCJfX3RpbWVzdGFtcF9taWNyb3Nfc2luY2VfdW5peF9lcG9jaF9fXCJdO1xuICByZXR1cm4gdHlwZW9mIG1pY3JvcyA9PT0gXCJiaWdpbnRcIjtcbn1cbmZ1bmN0aW9uIHRvQ29tcGFyYWJsZVZhbHVlKHZhbHVlKSB7XG4gIGlmIChpc0hleFNlcmlhbGl6YWJsZUxpa2UodmFsdWUpKSB7XG4gICAgcmV0dXJuIHZhbHVlLnRvSGV4U3RyaW5nKCk7XG4gIH1cbiAgaWYgKGlzVGltZXN0YW1wTGlrZSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gdmFsdWUuX190aW1lc3RhbXBfbWljcm9zX3NpbmNlX3VuaXhfZXBvY2hfXztcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5mdW5jdGlvbiBnZXRRdWVyeVRhYmxlTmFtZShxdWVyeSkge1xuICBpZiAocXVlcnkudGFibGUpIHJldHVybiBxdWVyeS50YWJsZS5uYW1lO1xuICBpZiAocXVlcnkubmFtZSkgcmV0dXJuIHF1ZXJ5Lm5hbWU7XG4gIGlmIChxdWVyeS5zb3VyY2VRdWVyeSkgcmV0dXJuIHF1ZXJ5LnNvdXJjZVF1ZXJ5LnRhYmxlLm5hbWU7XG4gIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBleHRyYWN0IHRhYmxlIG5hbWUgZnJvbSBxdWVyeVwiKTtcbn1cbmZ1bmN0aW9uIGdldFF1ZXJ5QWNjZXNzb3JOYW1lKHF1ZXJ5KSB7XG4gIGlmIChxdWVyeS50YWJsZSkgcmV0dXJuIHF1ZXJ5LnRhYmxlLmFjY2Vzc29yTmFtZTtcbiAgaWYgKHF1ZXJ5LmFjY2Vzc29yTmFtZSkgcmV0dXJuIHF1ZXJ5LmFjY2Vzc29yTmFtZTtcbiAgaWYgKHF1ZXJ5LnNvdXJjZVF1ZXJ5KSByZXR1cm4gcXVlcnkuc291cmNlUXVlcnkudGFibGUuYWNjZXNzb3JOYW1lO1xuICB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZXh0cmFjdCBhY2Nlc3NvciBuYW1lIGZyb20gcXVlcnlcIik7XG59XG5mdW5jdGlvbiBnZXRRdWVyeVdoZXJlQ2xhdXNlKHF1ZXJ5KSB7XG4gIGlmIChxdWVyeS53aGVyZUNsYXVzZSkgcmV0dXJuIHF1ZXJ5LndoZXJlQ2xhdXNlO1xuICByZXR1cm4gdm9pZCAwO1xufVxuXG4vLyBzcmMvc2VydmVyL3ZpZXdzLnRzXG5mdW5jdGlvbiBtYWtlVmlld0V4cG9ydChjdHgsIG9wdHMsIHBhcmFtcywgcmV0LCBmbikge1xuICBjb25zdCB2aWV3RXhwb3J0ID0gKFxuICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgdHlwZXNjcmlwdCBpbmNvcnJlY3RseSBzYXlzIEZ1bmN0aW9uI2JpbmQgcmVxdWlyZXMgYW4gYXJndW1lbnQuXG4gICAgZm4uYmluZCgpXG4gICk7XG4gIHZpZXdFeHBvcnRbZXhwb3J0Q29udGV4dF0gPSBjdHg7XG4gIHZpZXdFeHBvcnRbcmVnaXN0ZXJFeHBvcnRdID0gKGN0eDIsIGV4cG9ydE5hbWUpID0+IHtcbiAgICByZWdpc3RlclZpZXcoY3R4Miwgb3B0cywgZXhwb3J0TmFtZSwgZmFsc2UsIHBhcmFtcywgcmV0LCBmbik7XG4gIH07XG4gIHJldHVybiB2aWV3RXhwb3J0O1xufVxuZnVuY3Rpb24gbWFrZUFub25WaWV3RXhwb3J0KGN0eCwgb3B0cywgcGFyYW1zLCByZXQsIGZuKSB7XG4gIGNvbnN0IHZpZXdFeHBvcnQgPSAoXG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvciB0eXBlc2NyaXB0IGluY29ycmVjdGx5IHNheXMgRnVuY3Rpb24jYmluZCByZXF1aXJlcyBhbiBhcmd1bWVudC5cbiAgICBmbi5iaW5kKClcbiAgKTtcbiAgdmlld0V4cG9ydFtleHBvcnRDb250ZXh0XSA9IGN0eDtcbiAgdmlld0V4cG9ydFtyZWdpc3RlckV4cG9ydF0gPSAoY3R4MiwgZXhwb3J0TmFtZSkgPT4ge1xuICAgIHJlZ2lzdGVyVmlldyhjdHgyLCBvcHRzLCBleHBvcnROYW1lLCB0cnVlLCBwYXJhbXMsIHJldCwgZm4pO1xuICB9O1xuICByZXR1cm4gdmlld0V4cG9ydDtcbn1cbmZ1bmN0aW9uIHJlZ2lzdGVyVmlldyhjdHgsIG9wdHMsIGV4cG9ydE5hbWUsIGFub24sIHBhcmFtcywgcmV0LCBmbikge1xuICBjdHguZGVmaW5lRnVuY3Rpb24oZXhwb3J0TmFtZSk7XG4gIGNvbnN0IHBhcmFtc0J1aWxkZXIgPSBuZXcgUm93QnVpbGRlcihwYXJhbXMsIHRvUGFzY2FsQ2FzZShleHBvcnROYW1lKSk7XG4gIGxldCByZXR1cm5UeXBlID0gY3R4LnJlZ2lzdGVyVHlwZXNSZWN1cnNpdmVseShyZXQpLmFsZ2VicmFpY1R5cGU7XG4gIGNvbnN0IHsgdHlwZXNwYWNlIH0gPSBjdHg7XG4gIGNvbnN0IHsgdmFsdWU6IHBhcmFtVHlwZSB9ID0gY3R4LnJlc29sdmVUeXBlKFxuICAgIGN0eC5yZWdpc3RlclR5cGVzUmVjdXJzaXZlbHkocGFyYW1zQnVpbGRlcilcbiAgKTtcbiAgY3R4Lm1vZHVsZURlZi52aWV3cy5wdXNoKHtcbiAgICBzb3VyY2VOYW1lOiBleHBvcnROYW1lLFxuICAgIGluZGV4OiAoYW5vbiA/IGN0eC5hbm9uVmlld3MgOiBjdHgudmlld3MpLmxlbmd0aCxcbiAgICBpc1B1YmxpYzogb3B0cy5wdWJsaWMsXG4gICAgaXNBbm9ueW1vdXM6IGFub24sXG4gICAgcGFyYW1zOiBwYXJhbVR5cGUsXG4gICAgcmV0dXJuVHlwZVxuICB9KTtcbiAgY29uc3QgcHJpbWFyeUtleUNvbHVtbnMgPSB2aWV3UHJpbWFyeUtleUNvbHVtbnMocmV0KTtcbiAgaWYgKHByaW1hcnlLZXlDb2x1bW5zLmxlbmd0aCA+IDEpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFxuICAgICAgYFZpZXcgJyR7ZXhwb3J0TmFtZX0nIGNhbiBoYXZlIGF0IG1vc3Qgb25lIHByaW1hcnlLZXkoKSBjb2x1bW4gb24gaXRzIHJldHVybmVkIHJvdyB0eXBlOyBmb3VuZCAke3ByaW1hcnlLZXlDb2x1bW5zLmpvaW4oXCIsIFwiKX1gXG4gICAgKTtcbiAgfVxuICBpZiAocHJpbWFyeUtleUNvbHVtbnMubGVuZ3RoID09PSAxKSB7XG4gICAgY3R4Lm1vZHVsZURlZi52aWV3UHJpbWFyeUtleXMucHVzaCh7XG4gICAgICB2aWV3U291cmNlTmFtZTogZXhwb3J0TmFtZSxcbiAgICAgIGNvbHVtbnM6IHByaW1hcnlLZXlDb2x1bW5zXG4gICAgfSk7XG4gIH1cbiAgaWYgKG9wdHMubmFtZSAhPSBudWxsKSB7XG4gICAgY3R4Lm1vZHVsZURlZi5leHBsaWNpdE5hbWVzLmVudHJpZXMucHVzaCh7XG4gICAgICB0YWc6IFwiRnVuY3Rpb25cIixcbiAgICAgIHZhbHVlOiB7XG4gICAgICAgIHNvdXJjZU5hbWU6IGV4cG9ydE5hbWUsXG4gICAgICAgIGNhbm9uaWNhbE5hbWU6IG9wdHMubmFtZVxuICAgICAgfVxuICAgIH0pO1xuICB9XG4gIGlmIChyZXR1cm5UeXBlLnRhZyA9PSBcIlN1bVwiKSB7XG4gICAgY29uc3Qgb3JpZ2luYWxGbiA9IGZuO1xuICAgIGZuID0gKChjdHgyLCBhcmdzKSA9PiB7XG4gICAgICBjb25zdCByZXQyID0gb3JpZ2luYWxGbihjdHgyLCBhcmdzKTtcbiAgICAgIHJldHVybiByZXQyID09IG51bGwgPyBbXSA6IFtyZXQyXTtcbiAgICB9KTtcbiAgICByZXR1cm5UeXBlID0gQWxnZWJyYWljVHlwZS5BcnJheShcbiAgICAgIHJldHVyblR5cGUudmFsdWUudmFyaWFudHNbMF0uYWxnZWJyYWljVHlwZVxuICAgICk7XG4gIH1cbiAgKGFub24gPyBjdHguYW5vblZpZXdzIDogY3R4LnZpZXdzKS5wdXNoKHtcbiAgICBmbixcbiAgICBkZXNlcmlhbGl6ZVBhcmFtczogUHJvZHVjdFR5cGUubWFrZURlc2VyaWFsaXplcihwYXJhbVR5cGUsIHR5cGVzcGFjZSksXG4gICAgc2VyaWFsaXplUmV0dXJuOiBBbGdlYnJhaWNUeXBlLm1ha2VTZXJpYWxpemVyKHJldHVyblR5cGUsIHR5cGVzcGFjZSksXG4gICAgcmV0dXJuVHlwZUJhc2VTaXplOiBic2F0bkJhc2VTaXplKHR5cGVzcGFjZSwgcmV0dXJuVHlwZSlcbiAgfSk7XG59XG5mdW5jdGlvbiB2aWV3UHJpbWFyeUtleUNvbHVtbnMocmV0KSB7XG4gIGNvbnN0IHJvdyA9IHZpZXdSZXR1cm5Sb3cocmV0KTtcbiAgaWYgKHJvdyA9PSBudWxsKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG4gIHJldHVybiBPYmplY3QuZW50cmllcyhyb3cucm93KS5maWx0ZXIoXG4gICAgKGVudHJ5KSA9PiBlbnRyeVsxXS5jb2x1bW5NZXRhZGF0YS5pc1ByaW1hcnlLZXkgPT09IHRydWVcbiAgKS5tYXAoKFtuYW1lXSkgPT4gbmFtZSk7XG59XG5mdW5jdGlvbiB2aWV3UmV0dXJuUm93KHJldCkge1xuICBpZiAocmV0IGluc3RhbmNlb2YgQXJyYXlCdWlsZGVyICYmIHJldC5lbGVtZW50IGluc3RhbmNlb2YgUm93QnVpbGRlcikge1xuICAgIHJldHVybiByZXQuZWxlbWVudDtcbiAgfVxuICBpZiAocmV0IGluc3RhbmNlb2YgT3B0aW9uQnVpbGRlciAmJiByZXQudmFsdWUgaW5zdGFuY2VvZiBSb3dCdWlsZGVyKSB7XG4gICAgcmV0dXJuIHJldC52YWx1ZTtcbiAgfVxuICByZXR1cm4gdm9pZCAwO1xufVxuXG4vLyBzcmMvbGliL2Vycm9ycy50c1xudmFyIFNlbmRlckVycm9yID0gY2xhc3MgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2UpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgfVxuICBnZXQgbmFtZSgpIHtcbiAgICByZXR1cm4gXCJTZW5kZXJFcnJvclwiO1xuICB9XG59O1xuXG4vLyBzcmMvc2VydmVyL2Vycm9ycy50c1xudmFyIFNwYWNldGltZUhvc3RFcnJvciA9IGNsYXNzIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gIH1cbiAgZ2V0IG5hbWUoKSB7XG4gICAgcmV0dXJuIFwiU3BhY2V0aW1lSG9zdEVycm9yXCI7XG4gIH1cbn07XG52YXIgZXJyb3JEYXRhID0ge1xuICAvKipcbiAgICogQSBnZW5lcmljIGVycm9yIGNsYXNzIGZvciB1bmtub3duIGVycm9yIGNvZGVzLlxuICAgKi9cbiAgSG9zdENhbGxGYWlsdXJlOiAxLFxuICAvKipcbiAgICogRXJyb3IgaW5kaWNhdGluZyB0aGF0IGFuIEFCSSBjYWxsIHdhcyBtYWRlIG91dHNpZGUgb2YgYSB0cmFuc2FjdGlvbi5cbiAgICovXG4gIE5vdEluVHJhbnNhY3Rpb246IDIsXG4gIC8qKlxuICAgKiBFcnJvciBpbmRpY2F0aW5nIHRoYXQgQlNBVE4gZGVjb2RpbmcgZmFpbGVkLlxuICAgKiBUaGlzIHR5cGljYWxseSBtZWFucyB0aGF0IHRoZSBkYXRhIGNvdWxkIG5vdCBiZSBkZWNvZGVkIHRvIHRoZSBleHBlY3RlZCB0eXBlLlxuICAgKi9cbiAgQnNhdG5EZWNvZGVFcnJvcjogMyxcbiAgLyoqXG4gICAqIEVycm9yIGluZGljYXRpbmcgdGhhdCBhIHNwZWNpZmllZCB0YWJsZSBkb2VzIG5vdCBleGlzdC5cbiAgICovXG4gIE5vU3VjaFRhYmxlOiA0LFxuICAvKipcbiAgICogRXJyb3IgaW5kaWNhdGluZyB0aGF0IGEgc3BlY2lmaWVkIGluZGV4IGRvZXMgbm90IGV4aXN0LlxuICAgKi9cbiAgTm9TdWNoSW5kZXg6IDUsXG4gIC8qKlxuICAgKiBFcnJvciBpbmRpY2F0aW5nIHRoYXQgYSBzcGVjaWZpZWQgcm93IGl0ZXJhdG9yIGlzIG5vdCB2YWxpZC5cbiAgICovXG4gIE5vU3VjaEl0ZXI6IDYsXG4gIC8qKlxuICAgKiBFcnJvciBpbmRpY2F0aW5nIHRoYXQgYSBzcGVjaWZpZWQgY29uc29sZSB0aW1lciBkb2VzIG5vdCBleGlzdC5cbiAgICovXG4gIE5vU3VjaENvbnNvbGVUaW1lcjogNyxcbiAgLyoqXG4gICAqIEVycm9yIGluZGljYXRpbmcgdGhhdCBhIHNwZWNpZmllZCBieXRlcyBzb3VyY2Ugb3Igc2luayBpcyBub3QgdmFsaWQuXG4gICAqL1xuICBOb1N1Y2hCeXRlczogOCxcbiAgLyoqXG4gICAqIEVycm9yIGluZGljYXRpbmcgdGhhdCBhIHByb3ZpZGVkIHNpbmsgaGFzIG5vIG1vcmUgc3BhY2UgbGVmdC5cbiAgICovXG4gIE5vU3BhY2U6IDksXG4gIC8qKlxuICAgKiBFcnJvciBpbmRpY2F0aW5nIHRoYXQgdGhlcmUgaXMgbm8gbW9yZSBzcGFjZSBpbiB0aGUgZGF0YWJhc2UuXG4gICAqL1xuICBCdWZmZXJUb29TbWFsbDogMTEsXG4gIC8qKlxuICAgKiBFcnJvciBpbmRpY2F0aW5nIHRoYXQgYSB2YWx1ZSB3aXRoIGEgZ2l2ZW4gdW5pcXVlIGlkZW50aWZpZXIgYWxyZWFkeSBleGlzdHMuXG4gICAqL1xuICBVbmlxdWVBbHJlYWR5RXhpc3RzOiAxMixcbiAgLyoqXG4gICAqIEVycm9yIGluZGljYXRpbmcgdGhhdCB0aGUgc3BlY2lmaWVkIGRlbGF5IGluIHNjaGVkdWxpbmcgYSByb3cgd2FzIHRvbyBsb25nLlxuICAgKi9cbiAgU2NoZWR1bGVBdERlbGF5VG9vTG9uZzogMTMsXG4gIC8qKlxuICAgKiBFcnJvciBpbmRpY2F0aW5nIHRoYXQgYW4gaW5kZXggd2FzIG5vdCB1bmlxdWUgd2hlbiBpdCB3YXMgZXhwZWN0ZWQgdG8gYmUuXG4gICAqL1xuICBJbmRleE5vdFVuaXF1ZTogMTQsXG4gIC8qKlxuICAgKiBFcnJvciBpbmRpY2F0aW5nIHRoYXQgYW4gaW5kZXggd2FzIG5vdCB1bmlxdWUgd2hlbiBpdCB3YXMgZXhwZWN0ZWQgdG8gYmUuXG4gICAqL1xuICBOb1N1Y2hSb3c6IDE1LFxuICAvKipcbiAgICogRXJyb3IgaW5kaWNhdGluZyB0aGF0IGFuIGF1dG8taW5jcmVtZW50IHNlcXVlbmNlIGhhcyBvdmVyZmxvd2VkLlxuICAgKi9cbiAgQXV0b0luY092ZXJmbG93OiAxNixcbiAgV291bGRCbG9ja1RyYW5zYWN0aW9uOiAxNyxcbiAgVHJhbnNhY3Rpb25Ob3RBbm9ueW1vdXM6IDE4LFxuICBUcmFuc2FjdGlvbklzUmVhZE9ubHk6IDE5LFxuICBUcmFuc2FjdGlvbklzTXV0OiAyMCxcbiAgSHR0cEVycm9yOiAyMVxufTtcbmZ1bmN0aW9uIG1hcEVudHJpZXMoeCwgZikge1xuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9iamVjdC5lbnRyaWVzKHgpLm1hcCgoW2ssIHZdKSA9PiBbaywgZihrLCB2KV0pXG4gICk7XG59XG52YXIgZXJybm9Ub0NsYXNzID0gLyogQF9fUFVSRV9fICovIG5ldyBNYXAoKTtcbnZhciBlcnJvcnMgPSBPYmplY3QuZnJlZXplKFxuICBtYXBFbnRyaWVzKGVycm9yRGF0YSwgKG5hbWUsIGNvZGUpID0+IHtcbiAgICBjb25zdCBjbHMgPSBPYmplY3QuZGVmaW5lUHJvcGVydHkoXG4gICAgICBjbGFzcyBleHRlbmRzIFNwYWNldGltZUhvc3RFcnJvciB7XG4gICAgICAgIGdldCBuYW1lKCkge1xuICAgICAgICAgIHJldHVybiBuYW1lO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgXCJuYW1lXCIsXG4gICAgICB7IHZhbHVlOiBuYW1lLCB3cml0YWJsZTogZmFsc2UgfVxuICAgICk7XG4gICAgZXJybm9Ub0NsYXNzLnNldChjb2RlLCBjbHMpO1xuICAgIHJldHVybiBjbHM7XG4gIH0pXG4pO1xuZnVuY3Rpb24gZ2V0RXJyb3JDb25zdHJ1Y3Rvcihjb2RlKSB7XG4gIHJldHVybiBlcnJub1RvQ2xhc3MuZ2V0KGNvZGUpID8/IFNwYWNldGltZUhvc3RFcnJvcjtcbn1cblxuLy8gLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL3B1cmUtcmFuZEA3LjAuMS9ub2RlX21vZHVsZXMvcHVyZS1yYW5kL2xpYi9lc20vZGlzdHJpYnV0aW9uL1Vuc2FmZVVuaWZvcm1CaWdJbnREaXN0cmlidXRpb24uanNcbnZhciBTQmlnSW50ID0gdHlwZW9mIEJpZ0ludCAhPT0gXCJ1bmRlZmluZWRcIiA/IEJpZ0ludCA6IHZvaWQgMDtcbnZhciBPbmUgPSB0eXBlb2YgQmlnSW50ICE9PSBcInVuZGVmaW5lZFwiID8gQmlnSW50KDEpIDogdm9pZCAwO1xudmFyIFRoaXJ0eVR3byA9IHR5cGVvZiBCaWdJbnQgIT09IFwidW5kZWZpbmVkXCIgPyBCaWdJbnQoMzIpIDogdm9pZCAwO1xudmFyIE51bVZhbHVlcyA9IHR5cGVvZiBCaWdJbnQgIT09IFwidW5kZWZpbmVkXCIgPyBCaWdJbnQoNDI5NDk2NzI5NikgOiB2b2lkIDA7XG5mdW5jdGlvbiB1bnNhZmVVbmlmb3JtQmlnSW50RGlzdHJpYnV0aW9uKGZyb20sIHRvLCBybmcpIHtcbiAgdmFyIGRpZmYgPSB0byAtIGZyb20gKyBPbmU7XG4gIHZhciBGaW5hbE51bVZhbHVlcyA9IE51bVZhbHVlcztcbiAgdmFyIE51bUl0ZXJhdGlvbnMgPSAxO1xuICB3aGlsZSAoRmluYWxOdW1WYWx1ZXMgPCBkaWZmKSB7XG4gICAgRmluYWxOdW1WYWx1ZXMgPDw9IFRoaXJ0eVR3bztcbiAgICArK051bUl0ZXJhdGlvbnM7XG4gIH1cbiAgdmFyIHZhbHVlID0gZ2VuZXJhdGVOZXh0KE51bUl0ZXJhdGlvbnMsIHJuZyk7XG4gIGlmICh2YWx1ZSA8IGRpZmYpIHtcbiAgICByZXR1cm4gdmFsdWUgKyBmcm9tO1xuICB9XG4gIGlmICh2YWx1ZSArIGRpZmYgPCBGaW5hbE51bVZhbHVlcykge1xuICAgIHJldHVybiB2YWx1ZSAlIGRpZmYgKyBmcm9tO1xuICB9XG4gIHZhciBNYXhBY2NlcHRlZFJhbmRvbSA9IEZpbmFsTnVtVmFsdWVzIC0gRmluYWxOdW1WYWx1ZXMgJSBkaWZmO1xuICB3aGlsZSAodmFsdWUgPj0gTWF4QWNjZXB0ZWRSYW5kb20pIHtcbiAgICB2YWx1ZSA9IGdlbmVyYXRlTmV4dChOdW1JdGVyYXRpb25zLCBybmcpO1xuICB9XG4gIHJldHVybiB2YWx1ZSAlIGRpZmYgKyBmcm9tO1xufVxuZnVuY3Rpb24gZ2VuZXJhdGVOZXh0KE51bUl0ZXJhdGlvbnMsIHJuZykge1xuICB2YXIgdmFsdWUgPSBTQmlnSW50KHJuZy51bnNhZmVOZXh0KCkgKyAyMTQ3NDgzNjQ4KTtcbiAgZm9yICh2YXIgbnVtID0gMTsgbnVtIDwgTnVtSXRlcmF0aW9uczsgKytudW0pIHtcbiAgICB2YXIgb3V0ID0gcm5nLnVuc2FmZU5leHQoKTtcbiAgICB2YWx1ZSA9ICh2YWx1ZSA8PCBUaGlydHlUd28pICsgU0JpZ0ludChvdXQgKyAyMTQ3NDgzNjQ4KTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbi8vIC4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS9wdXJlLXJhbmRANy4wLjEvbm9kZV9tb2R1bGVzL3B1cmUtcmFuZC9saWIvZXNtL2Rpc3RyaWJ1dGlvbi9pbnRlcm5hbHMvVW5zYWZlVW5pZm9ybUludERpc3RyaWJ1dGlvbkludGVybmFsLmpzXG5mdW5jdGlvbiB1bnNhZmVVbmlmb3JtSW50RGlzdHJpYnV0aW9uSW50ZXJuYWwocmFuZ2VTaXplLCBybmcpIHtcbiAgdmFyIE1heEFsbG93ZWQgPSByYW5nZVNpemUgPiAyID8gfn4oNDI5NDk2NzI5NiAvIHJhbmdlU2l6ZSkgKiByYW5nZVNpemUgOiA0Mjk0OTY3Mjk2O1xuICB2YXIgZGVsdGFWID0gcm5nLnVuc2FmZU5leHQoKSArIDIxNDc0ODM2NDg7XG4gIHdoaWxlIChkZWx0YVYgPj0gTWF4QWxsb3dlZCkge1xuICAgIGRlbHRhViA9IHJuZy51bnNhZmVOZXh0KCkgKyAyMTQ3NDgzNjQ4O1xuICB9XG4gIHJldHVybiBkZWx0YVYgJSByYW5nZVNpemU7XG59XG5cbi8vIC4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS9wdXJlLXJhbmRANy4wLjEvbm9kZV9tb2R1bGVzL3B1cmUtcmFuZC9saWIvZXNtL2Rpc3RyaWJ1dGlvbi9pbnRlcm5hbHMvQXJyYXlJbnQ2NC5qc1xuZnVuY3Rpb24gZnJvbU51bWJlclRvQXJyYXlJbnQ2NChvdXQsIG4pIHtcbiAgaWYgKG4gPCAwKSB7XG4gICAgdmFyIHBvc04gPSAtbjtcbiAgICBvdXQuc2lnbiA9IC0xO1xuICAgIG91dC5kYXRhWzBdID0gfn4ocG9zTiAvIDQyOTQ5NjcyOTYpO1xuICAgIG91dC5kYXRhWzFdID0gcG9zTiA+Pj4gMDtcbiAgfSBlbHNlIHtcbiAgICBvdXQuc2lnbiA9IDE7XG4gICAgb3V0LmRhdGFbMF0gPSB+fihuIC8gNDI5NDk2NzI5Nik7XG4gICAgb3V0LmRhdGFbMV0gPSBuID4+PiAwO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5mdW5jdGlvbiBzdWJzdHJhY3RBcnJheUludDY0KG91dCwgYXJyYXlJbnRBLCBhcnJheUludEIpIHtcbiAgdmFyIGxvd0EgPSBhcnJheUludEEuZGF0YVsxXTtcbiAgdmFyIGhpZ2hBID0gYXJyYXlJbnRBLmRhdGFbMF07XG4gIHZhciBzaWduQSA9IGFycmF5SW50QS5zaWduO1xuICB2YXIgbG93QiA9IGFycmF5SW50Qi5kYXRhWzFdO1xuICB2YXIgaGlnaEIgPSBhcnJheUludEIuZGF0YVswXTtcbiAgdmFyIHNpZ25CID0gYXJyYXlJbnRCLnNpZ247XG4gIG91dC5zaWduID0gMTtcbiAgaWYgKHNpZ25BID09PSAxICYmIHNpZ25CID09PSAtMSkge1xuICAgIHZhciBsb3dfMSA9IGxvd0EgKyBsb3dCO1xuICAgIHZhciBoaWdoID0gaGlnaEEgKyBoaWdoQiArIChsb3dfMSA+IDQyOTQ5NjcyOTUgPyAxIDogMCk7XG4gICAgb3V0LmRhdGFbMF0gPSBoaWdoID4+PiAwO1xuICAgIG91dC5kYXRhWzFdID0gbG93XzEgPj4+IDA7XG4gICAgcmV0dXJuIG91dDtcbiAgfVxuICB2YXIgbG93Rmlyc3QgPSBsb3dBO1xuICB2YXIgaGlnaEZpcnN0ID0gaGlnaEE7XG4gIHZhciBsb3dTZWNvbmQgPSBsb3dCO1xuICB2YXIgaGlnaFNlY29uZCA9IGhpZ2hCO1xuICBpZiAoc2lnbkEgPT09IC0xKSB7XG4gICAgbG93Rmlyc3QgPSBsb3dCO1xuICAgIGhpZ2hGaXJzdCA9IGhpZ2hCO1xuICAgIGxvd1NlY29uZCA9IGxvd0E7XG4gICAgaGlnaFNlY29uZCA9IGhpZ2hBO1xuICB9XG4gIHZhciByZW1pbmRlckxvdyA9IDA7XG4gIHZhciBsb3cgPSBsb3dGaXJzdCAtIGxvd1NlY29uZDtcbiAgaWYgKGxvdyA8IDApIHtcbiAgICByZW1pbmRlckxvdyA9IDE7XG4gICAgbG93ID0gbG93ID4+PiAwO1xuICB9XG4gIG91dC5kYXRhWzBdID0gaGlnaEZpcnN0IC0gaGlnaFNlY29uZCAtIHJlbWluZGVyTG93O1xuICBvdXQuZGF0YVsxXSA9IGxvdztcbiAgcmV0dXJuIG91dDtcbn1cblxuLy8gLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL3B1cmUtcmFuZEA3LjAuMS9ub2RlX21vZHVsZXMvcHVyZS1yYW5kL2xpYi9lc20vZGlzdHJpYnV0aW9uL2ludGVybmFscy9VbnNhZmVVbmlmb3JtQXJyYXlJbnREaXN0cmlidXRpb25JbnRlcm5hbC5qc1xuZnVuY3Rpb24gdW5zYWZlVW5pZm9ybUFycmF5SW50RGlzdHJpYnV0aW9uSW50ZXJuYWwob3V0LCByYW5nZVNpemUsIHJuZykge1xuICB2YXIgcmFuZ2VMZW5ndGggPSByYW5nZVNpemUubGVuZ3RoO1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGZvciAodmFyIGluZGV4ID0gMDsgaW5kZXggIT09IHJhbmdlTGVuZ3RoOyArK2luZGV4KSB7XG4gICAgICB2YXIgaW5kZXhSYW5nZVNpemUgPSBpbmRleCA9PT0gMCA/IHJhbmdlU2l6ZVswXSArIDEgOiA0Mjk0OTY3Mjk2O1xuICAgICAgdmFyIGcgPSB1bnNhZmVVbmlmb3JtSW50RGlzdHJpYnV0aW9uSW50ZXJuYWwoaW5kZXhSYW5nZVNpemUsIHJuZyk7XG4gICAgICBvdXRbaW5kZXhdID0gZztcbiAgICB9XG4gICAgZm9yICh2YXIgaW5kZXggPSAwOyBpbmRleCAhPT0gcmFuZ2VMZW5ndGg7ICsraW5kZXgpIHtcbiAgICAgIHZhciBjdXJyZW50ID0gb3V0W2luZGV4XTtcbiAgICAgIHZhciBjdXJyZW50SW5SYW5nZSA9IHJhbmdlU2l6ZVtpbmRleF07XG4gICAgICBpZiAoY3VycmVudCA8IGN1cnJlbnRJblJhbmdlKSB7XG4gICAgICAgIHJldHVybiBvdXQ7XG4gICAgICB9IGVsc2UgaWYgKGN1cnJlbnQgPiBjdXJyZW50SW5SYW5nZSkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLy8gLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL3B1cmUtcmFuZEA3LjAuMS9ub2RlX21vZHVsZXMvcHVyZS1yYW5kL2xpYi9lc20vZGlzdHJpYnV0aW9uL1Vuc2FmZVVuaWZvcm1JbnREaXN0cmlidXRpb24uanNcbnZhciBzYWZlTnVtYmVyTWF4U2FmZUludGVnZXIgPSBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUjtcbnZhciBzaGFyZWRBID0geyBzaWduOiAxLCBkYXRhOiBbMCwgMF0gfTtcbnZhciBzaGFyZWRCID0geyBzaWduOiAxLCBkYXRhOiBbMCwgMF0gfTtcbnZhciBzaGFyZWRDID0geyBzaWduOiAxLCBkYXRhOiBbMCwgMF0gfTtcbnZhciBzaGFyZWREYXRhID0gWzAsIDBdO1xuZnVuY3Rpb24gdW5pZm9ybUxhcmdlSW50SW50ZXJuYWwoZnJvbSwgdG8sIHJhbmdlU2l6ZSwgcm5nKSB7XG4gIHZhciByYW5nZVNpemVBcnJheUludFZhbHVlID0gcmFuZ2VTaXplIDw9IHNhZmVOdW1iZXJNYXhTYWZlSW50ZWdlciA/IGZyb21OdW1iZXJUb0FycmF5SW50NjQoc2hhcmVkQywgcmFuZ2VTaXplKSA6IHN1YnN0cmFjdEFycmF5SW50NjQoc2hhcmVkQywgZnJvbU51bWJlclRvQXJyYXlJbnQ2NChzaGFyZWRBLCB0byksIGZyb21OdW1iZXJUb0FycmF5SW50NjQoc2hhcmVkQiwgZnJvbSkpO1xuICBpZiAocmFuZ2VTaXplQXJyYXlJbnRWYWx1ZS5kYXRhWzFdID09PSA0Mjk0OTY3Mjk1KSB7XG4gICAgcmFuZ2VTaXplQXJyYXlJbnRWYWx1ZS5kYXRhWzBdICs9IDE7XG4gICAgcmFuZ2VTaXplQXJyYXlJbnRWYWx1ZS5kYXRhWzFdID0gMDtcbiAgfSBlbHNlIHtcbiAgICByYW5nZVNpemVBcnJheUludFZhbHVlLmRhdGFbMV0gKz0gMTtcbiAgfVxuICB1bnNhZmVVbmlmb3JtQXJyYXlJbnREaXN0cmlidXRpb25JbnRlcm5hbChzaGFyZWREYXRhLCByYW5nZVNpemVBcnJheUludFZhbHVlLmRhdGEsIHJuZyk7XG4gIHJldHVybiBzaGFyZWREYXRhWzBdICogNDI5NDk2NzI5NiArIHNoYXJlZERhdGFbMV0gKyBmcm9tO1xufVxuZnVuY3Rpb24gdW5zYWZlVW5pZm9ybUludERpc3RyaWJ1dGlvbihmcm9tLCB0bywgcm5nKSB7XG4gIHZhciByYW5nZVNpemUgPSB0byAtIGZyb207XG4gIGlmIChyYW5nZVNpemUgPD0gNDI5NDk2NzI5NSkge1xuICAgIHZhciBnID0gdW5zYWZlVW5pZm9ybUludERpc3RyaWJ1dGlvbkludGVybmFsKHJhbmdlU2l6ZSArIDEsIHJuZyk7XG4gICAgcmV0dXJuIGcgKyBmcm9tO1xuICB9XG4gIHJldHVybiB1bmlmb3JtTGFyZ2VJbnRJbnRlcm5hbChmcm9tLCB0bywgcmFuZ2VTaXplLCBybmcpO1xufVxuXG4vLyAuLi8uLi9ub2RlX21vZHVsZXMvLnBucG0vcHVyZS1yYW5kQDcuMC4xL25vZGVfbW9kdWxlcy9wdXJlLXJhbmQvbGliL2VzbS9nZW5lcmF0b3IvWG9yb1NoaXJvLmpzXG52YXIgWG9yb1NoaXJvMTI4UGx1cyA9IChmdW5jdGlvbigpIHtcbiAgZnVuY3Rpb24gWG9yb1NoaXJvMTI4UGx1czIoczAxLCBzMDAsIHMxMSwgczEwKSB7XG4gICAgdGhpcy5zMDEgPSBzMDE7XG4gICAgdGhpcy5zMDAgPSBzMDA7XG4gICAgdGhpcy5zMTEgPSBzMTE7XG4gICAgdGhpcy5zMTAgPSBzMTA7XG4gIH1cbiAgWG9yb1NoaXJvMTI4UGx1czIucHJvdG90eXBlLmNsb25lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBYb3JvU2hpcm8xMjhQbHVzMih0aGlzLnMwMSwgdGhpcy5zMDAsIHRoaXMuczExLCB0aGlzLnMxMCk7XG4gIH07XG4gIFhvcm9TaGlybzEyOFBsdXMyLnByb3RvdHlwZS5uZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG5leHRSbmcgPSBuZXcgWG9yb1NoaXJvMTI4UGx1czIodGhpcy5zMDEsIHRoaXMuczAwLCB0aGlzLnMxMSwgdGhpcy5zMTApO1xuICAgIHZhciBvdXQgPSBuZXh0Um5nLnVuc2FmZU5leHQoKTtcbiAgICByZXR1cm4gW291dCwgbmV4dFJuZ107XG4gIH07XG4gIFhvcm9TaGlybzEyOFBsdXMyLnByb3RvdHlwZS51bnNhZmVOZXh0ID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG91dCA9IHRoaXMuczAwICsgdGhpcy5zMTAgfCAwO1xuICAgIHZhciBhMCA9IHRoaXMuczEwIF4gdGhpcy5zMDA7XG4gICAgdmFyIGExID0gdGhpcy5zMTEgXiB0aGlzLnMwMTtcbiAgICB2YXIgczAwID0gdGhpcy5zMDA7XG4gICAgdmFyIHMwMSA9IHRoaXMuczAxO1xuICAgIHRoaXMuczAwID0gczAwIDw8IDI0IF4gczAxID4+PiA4IF4gYTAgXiBhMCA8PCAxNjtcbiAgICB0aGlzLnMwMSA9IHMwMSA8PCAyNCBeIHMwMCA+Pj4gOCBeIGExIF4gKGExIDw8IDE2IHwgYTAgPj4+IDE2KTtcbiAgICB0aGlzLnMxMCA9IGExIDw8IDUgXiBhMCA+Pj4gMjc7XG4gICAgdGhpcy5zMTEgPSBhMCA8PCA1IF4gYTEgPj4+IDI3O1xuICAgIHJldHVybiBvdXQ7XG4gIH07XG4gIFhvcm9TaGlybzEyOFBsdXMyLnByb3RvdHlwZS5qdW1wID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG5leHRSbmcgPSBuZXcgWG9yb1NoaXJvMTI4UGx1czIodGhpcy5zMDEsIHRoaXMuczAwLCB0aGlzLnMxMSwgdGhpcy5zMTApO1xuICAgIG5leHRSbmcudW5zYWZlSnVtcCgpO1xuICAgIHJldHVybiBuZXh0Um5nO1xuICB9O1xuICBYb3JvU2hpcm8xMjhQbHVzMi5wcm90b3R5cGUudW5zYWZlSnVtcCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBuczAxID0gMDtcbiAgICB2YXIgbnMwMCA9IDA7XG4gICAgdmFyIG5zMTEgPSAwO1xuICAgIHZhciBuczEwID0gMDtcbiAgICB2YXIganVtcCA9IFszNjM5OTU2NjQ1LCAzNzUwNzU3MDEyLCAxMjYxNTY4NTA4LCAzODY0MjYzMzVdO1xuICAgIGZvciAodmFyIGkgPSAwOyBpICE9PSA0OyArK2kpIHtcbiAgICAgIGZvciAodmFyIG1hc2sgPSAxOyBtYXNrOyBtYXNrIDw8PSAxKSB7XG4gICAgICAgIGlmIChqdW1wW2ldICYgbWFzaykge1xuICAgICAgICAgIG5zMDEgXj0gdGhpcy5zMDE7XG4gICAgICAgICAgbnMwMCBePSB0aGlzLnMwMDtcbiAgICAgICAgICBuczExIF49IHRoaXMuczExO1xuICAgICAgICAgIG5zMTAgXj0gdGhpcy5zMTA7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy51bnNhZmVOZXh0KCk7XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuczAxID0gbnMwMTtcbiAgICB0aGlzLnMwMCA9IG5zMDA7XG4gICAgdGhpcy5zMTEgPSBuczExO1xuICAgIHRoaXMuczEwID0gbnMxMDtcbiAgfTtcbiAgWG9yb1NoaXJvMTI4UGx1czIucHJvdG90eXBlLmdldFN0YXRlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIFt0aGlzLnMwMSwgdGhpcy5zMDAsIHRoaXMuczExLCB0aGlzLnMxMF07XG4gIH07XG4gIHJldHVybiBYb3JvU2hpcm8xMjhQbHVzMjtcbn0pKCk7XG5mdW5jdGlvbiBmcm9tU3RhdGUoc3RhdGUpIHtcbiAgdmFyIHZhbGlkID0gc3RhdGUubGVuZ3RoID09PSA0O1xuICBpZiAoIXZhbGlkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiVGhlIHN0YXRlIG11c3QgaGF2ZSBiZWVuIHByb2R1Y2VkIGJ5IGEgeG9yb3NoaXJvMTI4cGx1cyBSYW5kb21HZW5lcmF0b3JcIik7XG4gIH1cbiAgcmV0dXJuIG5ldyBYb3JvU2hpcm8xMjhQbHVzKHN0YXRlWzBdLCBzdGF0ZVsxXSwgc3RhdGVbMl0sIHN0YXRlWzNdKTtcbn1cbnZhciB4b3Jvc2hpcm8xMjhwbHVzID0gT2JqZWN0LmFzc2lnbihmdW5jdGlvbihzZWVkKSB7XG4gIHJldHVybiBuZXcgWG9yb1NoaXJvMTI4UGx1cygtMSwgfnNlZWQsIHNlZWQgfCAwLCAwKTtcbn0sIHsgZnJvbVN0YXRlIH0pO1xuXG4vLyBzcmMvc2VydmVyL3JuZy50c1xudmFyIHsgYXNVaW50TiB9ID0gQmlnSW50O1xuZnVuY3Rpb24gcGNnMzIoc3RhdGUpIHtcbiAgY29uc3QgTVVMID0gNjM2NDEzNjIyMzg0Njc5MzAwNW47XG4gIGNvbnN0IElOQyA9IDExNjM0NTgwMDI3NDYyMjYwNzIzbjtcbiAgc3RhdGUgPSBhc1VpbnROKDY0LCBzdGF0ZSAqIE1VTCArIElOQyk7XG4gIGNvbnN0IHhvcnNoaWZ0ZWQgPSBOdW1iZXIoYXNVaW50TigzMiwgKHN0YXRlID4+IDE4biBeIHN0YXRlKSA+PiAyN24pKTtcbiAgY29uc3Qgcm90ID0gTnVtYmVyKGFzVWludE4oMzIsIHN0YXRlID4+IDU5bikpO1xuICByZXR1cm4geG9yc2hpZnRlZCA+PiByb3QgfCB4b3JzaGlmdGVkIDw8IDMyIC0gcm90O1xufVxuZnVuY3Rpb24gZ2VuZXJhdGVGbG9hdDY0KHJuZykge1xuICBjb25zdCBnMSA9IHVuc2FmZVVuaWZvcm1JbnREaXN0cmlidXRpb24oMCwgKDEgPDwgMjYpIC0gMSwgcm5nKTtcbiAgY29uc3QgZzIgPSB1bnNhZmVVbmlmb3JtSW50RGlzdHJpYnV0aW9uKDAsICgxIDw8IDI3KSAtIDEsIHJuZyk7XG4gIGNvbnN0IHZhbHVlID0gKGcxICogTWF0aC5wb3coMiwgMjcpICsgZzIpICogTWF0aC5wb3coMiwgLTUzKTtcbiAgcmV0dXJuIHZhbHVlO1xufVxuZnVuY3Rpb24gbWFrZVJhbmRvbShzZWVkKSB7XG4gIGNvbnN0IHJuZyA9IHhvcm9zaGlybzEyOHBsdXMocGNnMzIoc2VlZC5taWNyb3NTaW5jZVVuaXhFcG9jaCkpO1xuICBjb25zdCByYW5kb20gPSAoKSA9PiBnZW5lcmF0ZUZsb2F0NjQocm5nKTtcbiAgcmFuZG9tLmZpbGwgPSAoYXJyYXkpID0+IHtcbiAgICBpZiAoaXNCaWdJbnRBcnJheShhcnJheSkpIHtcbiAgICAgIGNvbnN0IHVwcGVyID0gKDFuIDw8IEJpZ0ludChhcnJheS5CWVRFU19QRVJfRUxFTUVOVCAqIDgpKSAtIDFuO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcnJheS5sZW5ndGg7IGkrKykge1xuICAgICAgICBhcnJheVtpXSA9IHVuc2FmZVVuaWZvcm1CaWdJbnREaXN0cmlidXRpb24oMG4sIHVwcGVyLCBybmcpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCB1cHBlciA9IE1hdGgucG93KDIsIGFycmF5LkJZVEVTX1BFUl9FTEVNRU5UICogOCkgLSAxO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcnJheS5sZW5ndGg7IGkrKykge1xuICAgICAgICBhcnJheVtpXSA9IHVuc2FmZVVuaWZvcm1JbnREaXN0cmlidXRpb24oMCwgdXBwZXIsIHJuZyk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBhcnJheTtcbiAgfTtcbiAgcmFuZG9tLnVpbnQzMiA9ICgpID0+IHJuZy51bnNhZmVOZXh0KCk7XG4gIHJhbmRvbS5pbnRlZ2VySW5SYW5nZSA9IChtaW4sIG1heCkgPT4gdW5zYWZlVW5pZm9ybUludERpc3RyaWJ1dGlvbihtaW4sIG1heCwgcm5nKTtcbiAgcmFuZG9tLmJpZ2ludEluUmFuZ2UgPSAobWluLCBtYXgpID0+IHVuc2FmZVVuaWZvcm1CaWdJbnREaXN0cmlidXRpb24obWluLCBtYXgsIHJuZyk7XG4gIHJldHVybiByYW5kb207XG59XG5mdW5jdGlvbiBpc0JpZ0ludEFycmF5KGFycmF5KSB7XG4gIHJldHVybiBhcnJheSBpbnN0YW5jZW9mIEJpZ0ludDY0QXJyYXkgfHwgYXJyYXkgaW5zdGFuY2VvZiBCaWdVaW50NjRBcnJheTtcbn1cblxuLy8gc3JjL3NlcnZlci9ydW50aW1lLnRzXG52YXIgeyBmcmVlemUgfSA9IE9iamVjdDtcbnZhciBzeXMgPSB7IC4uLl9zeXNjYWxsczJfMCwgLi4uX3N5c2NhbGxzMl8xIH07XG5mdW5jdGlvbiByZXF1ZXN0RnJvbVdpcmUocmVxdWVzdCwgYm9keSkge1xuICByZXR1cm4gUmVxdWVzdFttYWtlUmVxdWVzdF0oYm9keSwge1xuICAgIGhlYWRlcnM6IGRlc2VyaWFsaXplSGVhZGVycyhyZXF1ZXN0LmhlYWRlcnMpLFxuICAgIG1ldGhvZDogZGVzZXJpYWxpemVNZXRob2QocmVxdWVzdC5tZXRob2QpLFxuICAgIHVyaTogcmVxdWVzdC51cmksXG4gICAgdmVyc2lvbjogcmVxdWVzdC52ZXJzaW9uXG4gIH0pO1xufVxuZnVuY3Rpb24gcmVzcG9uc2VJbnRvV2lyZShyZXNwb25zZSkge1xuICByZXR1cm4gW1xuICAgIHtcbiAgICAgIGhlYWRlcnM6IHNlcmlhbGl6ZUhlYWRlcnMocmVzcG9uc2UuaGVhZGVycyksXG4gICAgICB2ZXJzaW9uOiByZXNwb25zZS52ZXJzaW9uLFxuICAgICAgY29kZTogcmVzcG9uc2Uuc3RhdHVzXG4gICAgfSxcbiAgICByZXNwb25zZS5ieXRlcygpXG4gIF07XG59XG5mdW5jdGlvbiBwYXJzZUpzb25PYmplY3QoanNvbikge1xuICBsZXQgdmFsdWU7XG4gIHRyeSB7XG4gICAgdmFsdWUgPSBKU09OLnBhcnNlKGpzb24pO1xuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIEpTT046IGZhaWxlZCB0byBwYXJzZSBzdHJpbmdcIik7XG4gIH1cbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGEgSlNPTiBvYmplY3QgYXQgdGhlIHRvcCBsZXZlbFwiKTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG52YXIgSnd0Q2xhaW1zSW1wbCA9IGNsYXNzIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgSnd0Q2xhaW1zIGluc3RhbmNlLlxuICAgKiBAcGFyYW0gcmF3UGF5bG9hZCBUaGUgSldUIHBheWxvYWQgYXMgYSByYXcgSlNPTiBzdHJpbmcuXG4gICAqIEBwYXJhbSBpZGVudGl0eSBUaGUgaWRlbnRpdHkgZm9yIHRoaXMgSldULiBXZSBhcmUgb25seSB0YWtpbmcgdGhpcyBiZWNhdXNlIHdlIGRvbid0IGhhdmUgYSBibGFrZTMgaW1wbGVtZW50YXRpb24gKHdoaWNoIHdlIG5lZWQgdG8gY29tcHV0ZSBpdCkuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihyYXdQYXlsb2FkLCBpZGVudGl0eSkge1xuICAgIHRoaXMucmF3UGF5bG9hZCA9IHJhd1BheWxvYWQ7XG4gICAgdGhpcy5mdWxsUGF5bG9hZCA9IHBhcnNlSnNvbk9iamVjdChyYXdQYXlsb2FkKTtcbiAgICB0aGlzLl9pZGVudGl0eSA9IGlkZW50aXR5O1xuICB9XG4gIGZ1bGxQYXlsb2FkO1xuICBfaWRlbnRpdHk7XG4gIGdldCBpZGVudGl0eSgpIHtcbiAgICByZXR1cm4gdGhpcy5faWRlbnRpdHk7XG4gIH1cbiAgZ2V0IHN1YmplY3QoKSB7XG4gICAgcmV0dXJuIHRoaXMuZnVsbFBheWxvYWRbXCJzdWJcIl07XG4gIH1cbiAgZ2V0IGlzc3VlcigpIHtcbiAgICByZXR1cm4gdGhpcy5mdWxsUGF5bG9hZFtcImlzc1wiXTtcbiAgfVxuICBnZXQgYXVkaWVuY2UoKSB7XG4gICAgY29uc3QgYXVkID0gdGhpcy5mdWxsUGF5bG9hZFtcImF1ZFwiXTtcbiAgICBpZiAoYXVkID09IG51bGwpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gICAgcmV0dXJuIHR5cGVvZiBhdWQgPT09IFwic3RyaW5nXCIgPyBbYXVkXSA6IGF1ZDtcbiAgfVxufTtcbnZhciBBdXRoQ3R4SW1wbCA9IGNsYXNzIF9BdXRoQ3R4SW1wbCB7XG4gIGlzSW50ZXJuYWw7XG4gIC8vIFNvdXJjZSBvZiB0aGUgSldUIHBheWxvYWQgc3RyaW5nLCBpZiB0aGVyZSBpcyBvbmUuXG4gIF9qd3RTb3VyY2U7XG4gIC8vIFdoZXRoZXIgd2UgaGF2ZSBpbml0aWFsaXplZCB0aGUgSldUIGNsYWltcy5cbiAgX2luaXRpYWxpemVkSldUID0gZmFsc2U7XG4gIF9qd3RDbGFpbXM7XG4gIF9zZW5kZXJJZGVudGl0eTtcbiAgY29uc3RydWN0b3Iob3B0cykge1xuICAgIHRoaXMuaXNJbnRlcm5hbCA9IG9wdHMuaXNJbnRlcm5hbDtcbiAgICB0aGlzLl9qd3RTb3VyY2UgPSBvcHRzLmp3dFNvdXJjZTtcbiAgICB0aGlzLl9zZW5kZXJJZGVudGl0eSA9IG9wdHMuc2VuZGVySWRlbnRpdHk7XG4gIH1cbiAgX2luaXRpYWxpemVKV1QoKSB7XG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVkSldUKSByZXR1cm47XG4gICAgdGhpcy5faW5pdGlhbGl6ZWRKV1QgPSB0cnVlO1xuICAgIGNvbnN0IHRva2VuID0gdGhpcy5fand0U291cmNlKCk7XG4gICAgaWYgKCF0b2tlbikge1xuICAgICAgdGhpcy5fand0Q2xhaW1zID0gbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fand0Q2xhaW1zID0gbmV3IEp3dENsYWltc0ltcGwodG9rZW4sIHRoaXMuX3NlbmRlcklkZW50aXR5KTtcbiAgICB9XG4gICAgT2JqZWN0LmZyZWV6ZSh0aGlzKTtcbiAgfVxuICAvKiogTGF6aWx5IGNvbXB1dGUgd2hldGhlciBhIEpXVCBleGlzdHMgYW5kIGlzIHBhcnNlYWJsZS4gKi9cbiAgZ2V0IGhhc0pXVCgpIHtcbiAgICB0aGlzLl9pbml0aWFsaXplSldUKCk7XG4gICAgcmV0dXJuIHRoaXMuX2p3dENsYWltcyAhPT0gbnVsbDtcbiAgfVxuICAvKiogTGF6aWx5IHBhcnNlIHRoZSBKd3RDbGFpbXMgb25seSB3aGVuIGFjY2Vzc2VkLiAqL1xuICBnZXQgand0KCkge1xuICAgIHRoaXMuX2luaXRpYWxpemVKV1QoKTtcbiAgICByZXR1cm4gdGhpcy5fand0Q2xhaW1zO1xuICB9XG4gIC8qKiBDcmVhdGUgYSBjb250ZXh0IHJlcHJlc2VudGluZyBpbnRlcm5hbCAobm9uLXVzZXIpIHJlcXVlc3RzLiAqL1xuICBzdGF0aWMgaW50ZXJuYWwoKSB7XG4gICAgcmV0dXJuIG5ldyBfQXV0aEN0eEltcGwoe1xuICAgICAgaXNJbnRlcm5hbDogdHJ1ZSxcbiAgICAgIGp3dFNvdXJjZTogKCkgPT4gbnVsbCxcbiAgICAgIHNlbmRlcklkZW50aXR5OiBJZGVudGl0eS56ZXJvKClcbiAgICB9KTtcbiAgfVxuICAvKiogSWYgdGhlcmUgaXMgYSBjb25uZWN0aW9uIGlkLCBsb29rIHVwIHRoZSBKV1QgcGF5bG9hZCBmcm9tIHRoZSBzeXN0ZW0gdGFibGVzLiAqL1xuICBzdGF0aWMgZnJvbVN5c3RlbVRhYmxlcyhjb25uZWN0aW9uSWQsIHNlbmRlcikge1xuICAgIGlmIChjb25uZWN0aW9uSWQgPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBuZXcgX0F1dGhDdHhJbXBsKHtcbiAgICAgICAgaXNJbnRlcm5hbDogZmFsc2UsXG4gICAgICAgIGp3dFNvdXJjZTogKCkgPT4gbnVsbCxcbiAgICAgICAgc2VuZGVySWRlbnRpdHk6IHNlbmRlclxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgX0F1dGhDdHhJbXBsKHtcbiAgICAgIGlzSW50ZXJuYWw6IGZhbHNlLFxuICAgICAgand0U291cmNlOiAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHBheWxvYWRCdWYgPSBzeXMuZ2V0X2p3dF9wYXlsb2FkKGNvbm5lY3Rpb25JZC5fX2Nvbm5lY3Rpb25faWRfXyk7XG4gICAgICAgIGlmIChwYXlsb2FkQnVmLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgICAgIGNvbnN0IHBheWxvYWRTdHIgPSBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocGF5bG9hZEJ1Zik7XG4gICAgICAgIHJldHVybiBwYXlsb2FkU3RyO1xuICAgICAgfSxcbiAgICAgIHNlbmRlcklkZW50aXR5OiBzZW5kZXJcbiAgICB9KTtcbiAgfVxufTtcbnZhciBSZWR1Y2VyQ3R4SW1wbCA9IGNsYXNzIFJlZHVjZXJDdHgge1xuICAjaWRlbnRpdHk7XG4gICNzZW5kZXJBdXRoO1xuICAjdXVpZENvdW50ZXI7XG4gICNyYW5kb207XG4gIHNlbmRlcjtcbiAgdGltZXN0YW1wO1xuICBjb25uZWN0aW9uSWQ7XG4gIGRiO1xuICBjb25zdHJ1Y3RvcihzZW5kZXIsIHRpbWVzdGFtcCwgY29ubmVjdGlvbklkLCBkYlZpZXcpIHtcbiAgICBPYmplY3Quc2VhbCh0aGlzKTtcbiAgICB0aGlzLnNlbmRlciA9IHNlbmRlcjtcbiAgICB0aGlzLnRpbWVzdGFtcCA9IHRpbWVzdGFtcDtcbiAgICB0aGlzLmNvbm5lY3Rpb25JZCA9IGNvbm5lY3Rpb25JZDtcbiAgICB0aGlzLmRiID0gZGJWaWV3O1xuICB9XG4gIC8qKiBSZXNldCB0aGUgYFJlZHVjZXJDdHhgIHRvIGJlIHVzZWQgZm9yIGEgbmV3IHRyYW5zYWN0aW9uICovXG4gIHN0YXRpYyByZXNldChtZSwgc2VuZGVyLCB0aW1lc3RhbXAsIGNvbm5lY3Rpb25JZCkge1xuICAgIG1lLnNlbmRlciA9IHNlbmRlcjtcbiAgICBtZS50aW1lc3RhbXAgPSB0aW1lc3RhbXA7XG4gICAgbWUuY29ubmVjdGlvbklkID0gY29ubmVjdGlvbklkO1xuICAgIG1lLiN1dWlkQ291bnRlciA9IHZvaWQgMDtcbiAgICBtZS4jc2VuZGVyQXV0aCA9IHZvaWQgMDtcbiAgfVxuICBnZXQgZGF0YWJhc2VJZGVudGl0eSgpIHtcbiAgICByZXR1cm4gdGhpcy4jaWRlbnRpdHkgPz89IG5ldyBJZGVudGl0eShzeXMuaWRlbnRpdHkoKSk7XG4gIH1cbiAgZ2V0IGlkZW50aXR5KCkge1xuICAgIHJldHVybiB0aGlzLmRhdGFiYXNlSWRlbnRpdHk7XG4gIH1cbiAgZ2V0IHNlbmRlckF1dGgoKSB7XG4gICAgcmV0dXJuIHRoaXMuI3NlbmRlckF1dGggPz89IEF1dGhDdHhJbXBsLmZyb21TeXN0ZW1UYWJsZXMoXG4gICAgICB0aGlzLmNvbm5lY3Rpb25JZCxcbiAgICAgIHRoaXMuc2VuZGVyXG4gICAgKTtcbiAgfVxuICBnZXQgcmFuZG9tKCkge1xuICAgIHJldHVybiB0aGlzLiNyYW5kb20gPz89IG1ha2VSYW5kb20odGhpcy50aW1lc3RhbXApO1xuICB9XG4gIC8qKlxuICAgKiBDcmVhdGUgYSBuZXcgcmFuZG9tIHtAbGluayBVdWlkfSBgdjRgIHVzaW5nIHRoaXMgYFJlZHVjZXJDdHhgJ3MgUk5HLlxuICAgKi9cbiAgbmV3VXVpZFY0KCkge1xuICAgIGNvbnN0IGJ5dGVzID0gdGhpcy5yYW5kb20uZmlsbChuZXcgVWludDhBcnJheSgxNikpO1xuICAgIHJldHVybiBVdWlkLmZyb21SYW5kb21CeXRlc1Y0KGJ5dGVzKTtcbiAgfVxuICAvKipcbiAgICogQ3JlYXRlIGEgbmV3IHNvcnRhYmxlIHtAbGluayBVdWlkfSBgdjdgIHVzaW5nIHRoaXMgYFJlZHVjZXJDdHhgJ3MgUk5HLCBjb3VudGVyLFxuICAgKiBhbmQgdGltZXN0YW1wLlxuICAgKi9cbiAgbmV3VXVpZFY3KCkge1xuICAgIGNvbnN0IGJ5dGVzID0gdGhpcy5yYW5kb20uZmlsbChuZXcgVWludDhBcnJheSg0KSk7XG4gICAgY29uc3QgY291bnRlciA9IHRoaXMuI3V1aWRDb3VudGVyID8/PSB7IHZhbHVlOiAwIH07XG4gICAgcmV0dXJuIFV1aWQuZnJvbUNvdW50ZXJWNyhjb3VudGVyLCB0aGlzLnRpbWVzdGFtcCwgYnl0ZXMpO1xuICB9XG59O1xudmFyIGNhbGxVc2VyRnVuY3Rpb24gPSBmdW5jdGlvbiBfX3NwYWNldGltZWRiX2VuZF9zaG9ydF9iYWNrdHJhY2UoZm4sIC4uLmFyZ3MpIHtcbiAgcmV0dXJuIGZuKC4uLmFyZ3MpO1xufTtcbmZ1bmN0aW9uIHJ1bldpdGhUeChtYWtlQ3R4LCBib2R5KSB7XG4gIGNvbnN0IHJ1biA9ICgpID0+IHtcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBzeXMucHJvY2VkdXJlX3N0YXJ0X211dF90eCgpO1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYm9keShtYWtlQ3R4KG5ldyBUaW1lc3RhbXAodGltZXN0YW1wKSkpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHN5cy5wcm9jZWR1cmVfYWJvcnRfbXV0X3R4KCk7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfTtcbiAgbGV0IHJlcyA9IHJ1bigpO1xuICB0cnkge1xuICAgIHN5cy5wcm9jZWR1cmVfY29tbWl0X211dF90eCgpO1xuICAgIHJldHVybiByZXM7XG4gIH0gY2F0Y2gge1xuICB9XG4gIGNvbnNvbGUud2FybihcImNvbW1pdHRpbmcgYW5vbnltb3VzIHRyYW5zYWN0aW9uIGZhaWxlZFwiKTtcbiAgcmVzID0gcnVuKCk7XG4gIHRyeSB7XG4gICAgc3lzLnByb2NlZHVyZV9jb21taXRfbXV0X3R4KCk7XG4gICAgcmV0dXJuIHJlcztcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcInRyYW5zYWN0aW9uIHJldHJ5IGZhaWxlZCBhZ2FpblwiLCB7IGNhdXNlOiBlIH0pO1xuICB9XG59XG52YXIgbWFrZUhvb2tzID0gKHNjaGVtYTIpID0+IG5ldyBNb2R1bGVIb29rc0ltcGwoc2NoZW1hMik7XG52YXIgTW9kdWxlSG9va3NJbXBsID0gY2xhc3Mge1xuICAjc2NoZW1hO1xuICAjZGJWaWV3XztcbiAgI3JlZHVjZXJBcmdzRGVzZXJpYWxpemVycztcbiAgLyoqIENhY2hlIHRoZSBgUmVkdWNlckN0eGAgb2JqZWN0IHRvIGF2b2lkIGFsbG9jYXRpbmcgYW5ldyBmb3IgZXZlciByZWR1Y2VyIGNhbGwuICovXG4gICNyZWR1Y2VyQ3R4XztcbiAgY29uc3RydWN0b3Ioc2NoZW1hMikge1xuICAgIHRoaXMuI3NjaGVtYSA9IHNjaGVtYTI7XG4gICAgdGhpcy4jcmVkdWNlckFyZ3NEZXNlcmlhbGl6ZXJzID0gc2NoZW1hMi5tb2R1bGVEZWYucmVkdWNlcnMubWFwKFxuICAgICAgKHsgcGFyYW1zIH0pID0+IFByb2R1Y3RUeXBlLm1ha2VEZXNlcmlhbGl6ZXIocGFyYW1zLCBzY2hlbWEyLnR5cGVzcGFjZSlcbiAgICApO1xuICB9XG4gIGdldCAjZGJWaWV3KCkge1xuICAgIHJldHVybiB0aGlzLiNkYlZpZXdfID8/PSBmcmVlemUoXG4gICAgICBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICAgIE9iamVjdC52YWx1ZXModGhpcy4jc2NoZW1hLnNjaGVtYVR5cGUudGFibGVzKS5tYXAoKHRhYmxlMikgPT4gW1xuICAgICAgICAgIHRhYmxlMi5hY2Nlc3Nvck5hbWUsXG4gICAgICAgICAgbWFrZVRhYmxlVmlldyh0aGlzLiNzY2hlbWEudHlwZXNwYWNlLCB0YWJsZTIudGFibGVEZWYpXG4gICAgICAgIF0pXG4gICAgICApXG4gICAgKTtcbiAgfVxuICBnZXQgI3JlZHVjZXJDdHgoKSB7XG4gICAgcmV0dXJuIHRoaXMuI3JlZHVjZXJDdHhfID8/PSBuZXcgUmVkdWNlckN0eEltcGwoXG4gICAgICBJZGVudGl0eS56ZXJvKCksXG4gICAgICBUaW1lc3RhbXAuVU5JWF9FUE9DSCxcbiAgICAgIG51bGwsXG4gICAgICB0aGlzLiNkYlZpZXdcbiAgICApO1xuICB9XG4gIF9fZGVzY3JpYmVfbW9kdWxlX18oKSB7XG4gICAgY29uc3Qgd3JpdGVyID0gbmV3IEJpbmFyeVdyaXRlcigxMjgpO1xuICAgIFJhd01vZHVsZURlZi5zZXJpYWxpemUoXG4gICAgICB3cml0ZXIsXG4gICAgICBSYXdNb2R1bGVEZWYuVjEwKHRoaXMuI3NjaGVtYS5yYXdNb2R1bGVEZWZWMTAoKSlcbiAgICApO1xuICAgIHJldHVybiB3cml0ZXIuZ2V0QnVmZmVyKCk7XG4gIH1cbiAgX19nZXRfZXJyb3JfY29uc3RydWN0b3JfXyhjb2RlKSB7XG4gICAgcmV0dXJuIGdldEVycm9yQ29uc3RydWN0b3IoY29kZSk7XG4gIH1cbiAgZ2V0IF9fc2VuZGVyX2Vycm9yX2NsYXNzX18oKSB7XG4gICAgcmV0dXJuIFNlbmRlckVycm9yO1xuICB9XG4gIF9fY2FsbF9yZWR1Y2VyX18ocmVkdWNlcklkLCBzZW5kZXIsIGNvbm5JZCwgdGltZXN0YW1wLCBhcmdzQnVmKSB7XG4gICAgY29uc3QgbW9kdWxlQ3R4ID0gdGhpcy4jc2NoZW1hO1xuICAgIGNvbnN0IGRlc2VyaWFsaXplQXJncyA9IHRoaXMuI3JlZHVjZXJBcmdzRGVzZXJpYWxpemVyc1tyZWR1Y2VySWRdO1xuICAgIEJJTkFSWV9SRUFERVIucmVzZXQoYXJnc0J1Zik7XG4gICAgY29uc3QgYXJncyA9IGRlc2VyaWFsaXplQXJncyhCSU5BUllfUkVBREVSKTtcbiAgICBjb25zdCBzZW5kZXJJZGVudGl0eSA9IG5ldyBJZGVudGl0eShzZW5kZXIpO1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuI3JlZHVjZXJDdHg7XG4gICAgUmVkdWNlckN0eEltcGwucmVzZXQoXG4gICAgICBjdHgsXG4gICAgICBzZW5kZXJJZGVudGl0eSxcbiAgICAgIG5ldyBUaW1lc3RhbXAodGltZXN0YW1wKSxcbiAgICAgIENvbm5lY3Rpb25JZC5udWxsSWZaZXJvKG5ldyBDb25uZWN0aW9uSWQoY29ubklkKSlcbiAgICApO1xuICAgIGNhbGxVc2VyRnVuY3Rpb24obW9kdWxlQ3R4LnJlZHVjZXJzW3JlZHVjZXJJZF0sIGN0eCwgYXJncyk7XG4gIH1cbiAgX19jYWxsX3ZpZXdfXyhpZCwgc2VuZGVyLCBhcmdzQnVmKSB7XG4gICAgY29uc3QgbW9kdWxlQ3R4ID0gdGhpcy4jc2NoZW1hO1xuICAgIGNvbnN0IHsgZm4sIGRlc2VyaWFsaXplUGFyYW1zLCBzZXJpYWxpemVSZXR1cm4sIHJldHVyblR5cGVCYXNlU2l6ZSB9ID0gbW9kdWxlQ3R4LnZpZXdzW2lkXTtcbiAgICBjb25zdCBjdHggPSBmcmVlemUoe1xuICAgICAgc2VuZGVyOiBuZXcgSWRlbnRpdHkoc2VuZGVyKSxcbiAgICAgIC8vIHRoaXMgaXMgdGhlIG5vbi1yZWFkb25seSBEYlZpZXcsIGJ1dCB0aGUgdHlwaW5nIGZvciB0aGUgdXNlciB3aWxsIGJlXG4gICAgICAvLyB0aGUgcmVhZG9ubHkgb25lLCBhbmQgaWYgdGhleSBkbyBjYWxsIG11dGF0aW5nIGZ1bmN0aW9ucyBpdCB3aWxsIGZhaWxcbiAgICAgIC8vIGF0IHJ1bnRpbWVcbiAgICAgIGRiOiB0aGlzLiNkYlZpZXcsXG4gICAgICBmcm9tOiBtYWtlUXVlcnlCdWlsZGVyKG1vZHVsZUN0eC5zY2hlbWFUeXBlKVxuICAgIH0pO1xuICAgIGNvbnN0IGFyZ3MgPSBkZXNlcmlhbGl6ZVBhcmFtcyhuZXcgQmluYXJ5UmVhZGVyKGFyZ3NCdWYpKTtcbiAgICBjb25zdCByZXQgPSBjYWxsVXNlckZ1bmN0aW9uKGZuLCBjdHgsIGFyZ3MpO1xuICAgIGNvbnN0IHJldEJ1ZiA9IG5ldyBCaW5hcnlXcml0ZXIocmV0dXJuVHlwZUJhc2VTaXplKTtcbiAgICBpZiAoaXNSb3dUeXBlZFF1ZXJ5KHJldCkpIHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gdG9TcWwocmV0KTtcbiAgICAgIFZpZXdSZXN1bHRIZWFkZXIuc2VyaWFsaXplKHJldEJ1ZiwgVmlld1Jlc3VsdEhlYWRlci5SYXdTcWwocXVlcnkpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgVmlld1Jlc3VsdEhlYWRlci5zZXJpYWxpemUocmV0QnVmLCBWaWV3UmVzdWx0SGVhZGVyLlJvd0RhdGEpO1xuICAgICAgc2VyaWFsaXplUmV0dXJuKHJldEJ1ZiwgcmV0KTtcbiAgICB9XG4gICAgcmV0dXJuIHsgZGF0YTogcmV0QnVmLmdldEJ1ZmZlcigpIH07XG4gIH1cbiAgX19jYWxsX3ZpZXdfYW5vbl9fKGlkLCBhcmdzQnVmKSB7XG4gICAgY29uc3QgbW9kdWxlQ3R4ID0gdGhpcy4jc2NoZW1hO1xuICAgIGNvbnN0IHsgZm4sIGRlc2VyaWFsaXplUGFyYW1zLCBzZXJpYWxpemVSZXR1cm4sIHJldHVyblR5cGVCYXNlU2l6ZSB9ID0gbW9kdWxlQ3R4LmFub25WaWV3c1tpZF07XG4gICAgY29uc3QgY3R4ID0gZnJlZXplKHtcbiAgICAgIC8vIHRoaXMgaXMgdGhlIG5vbi1yZWFkb25seSBEYlZpZXcsIGJ1dCB0aGUgdHlwaW5nIGZvciB0aGUgdXNlciB3aWxsIGJlXG4gICAgICAvLyB0aGUgcmVhZG9ubHkgb25lLCBhbmQgaWYgdGhleSBkbyBjYWxsIG11dGF0aW5nIGZ1bmN0aW9ucyBpdCB3aWxsIGZhaWxcbiAgICAgIC8vIGF0IHJ1bnRpbWVcbiAgICAgIGRiOiB0aGlzLiNkYlZpZXcsXG4gICAgICBmcm9tOiBtYWtlUXVlcnlCdWlsZGVyKG1vZHVsZUN0eC5zY2hlbWFUeXBlKVxuICAgIH0pO1xuICAgIGNvbnN0IGFyZ3MgPSBkZXNlcmlhbGl6ZVBhcmFtcyhuZXcgQmluYXJ5UmVhZGVyKGFyZ3NCdWYpKTtcbiAgICBjb25zdCByZXQgPSBjYWxsVXNlckZ1bmN0aW9uKGZuLCBjdHgsIGFyZ3MpO1xuICAgIGNvbnN0IHJldEJ1ZiA9IG5ldyBCaW5hcnlXcml0ZXIocmV0dXJuVHlwZUJhc2VTaXplKTtcbiAgICBpZiAoaXNSb3dUeXBlZFF1ZXJ5KHJldCkpIHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gdG9TcWwocmV0KTtcbiAgICAgIFZpZXdSZXN1bHRIZWFkZXIuc2VyaWFsaXplKHJldEJ1ZiwgVmlld1Jlc3VsdEhlYWRlci5SYXdTcWwocXVlcnkpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgVmlld1Jlc3VsdEhlYWRlci5zZXJpYWxpemUocmV0QnVmLCBWaWV3UmVzdWx0SGVhZGVyLlJvd0RhdGEpO1xuICAgICAgc2VyaWFsaXplUmV0dXJuKHJldEJ1ZiwgcmV0KTtcbiAgICB9XG4gICAgcmV0dXJuIHsgZGF0YTogcmV0QnVmLmdldEJ1ZmZlcigpIH07XG4gIH1cbiAgX19jYWxsX3Byb2NlZHVyZV9fKGlkLCBzZW5kZXIsIGNvbm5lY3Rpb25faWQsIHRpbWVzdGFtcCwgYXJncykge1xuICAgIHJldHVybiBjYWxsUHJvY2VkdXJlKFxuICAgICAgdGhpcy4jc2NoZW1hLFxuICAgICAgaWQsXG4gICAgICBuZXcgSWRlbnRpdHkoc2VuZGVyKSxcbiAgICAgIENvbm5lY3Rpb25JZC5udWxsSWZaZXJvKG5ldyBDb25uZWN0aW9uSWQoY29ubmVjdGlvbl9pZCkpLFxuICAgICAgbmV3IFRpbWVzdGFtcCh0aW1lc3RhbXApLFxuICAgICAgYXJncyxcbiAgICAgICgpID0+IHRoaXMuI2RiVmlld1xuICAgICk7XG4gIH1cbiAgX19jYWxsX2h0dHBfaGFuZGxlcl9fKGlkLCB0aW1lc3RhbXAsIHJlcXVlc3QsIGJvZHkpIHtcbiAgICBjb25zdCBtb2R1bGVDdHggPSB0aGlzLiNzY2hlbWE7XG4gICAgY29uc3QgaGFuZGxlciA9IG1vZHVsZUN0eC5odHRwSGFuZGxlcnNbaWRdO1xuICAgIGNvbnN0IGN0eCA9IG5ldyBIYW5kbGVyQ29udGV4dEltcGwoXG4gICAgICBuZXcgVGltZXN0YW1wKHRpbWVzdGFtcCksXG4gICAgICAoKSA9PiB0aGlzLiNkYlZpZXdcbiAgICApO1xuICAgIGNvbnN0IHJlcXVlc3RNZXRhZGF0YSA9IEh0dHBSZXF1ZXN0LmRlc2VyaWFsaXplKG5ldyBCaW5hcnlSZWFkZXIocmVxdWVzdCkpO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gY2FsbFVzZXJGdW5jdGlvbihcbiAgICAgIGhhbmRsZXIsXG4gICAgICBjdHgsXG4gICAgICByZXF1ZXN0RnJvbVdpcmUocmVxdWVzdE1ldGFkYXRhLCBib2R5KVxuICAgICk7XG4gICAgY29uc3QgW3Jlc3BvbnNlTWV0YWRhdGEsIHJlc3BvbnNlQm9keV0gPSByZXNwb25zZUludG9XaXJlKHJlc3BvbnNlKTtcbiAgICBjb25zdCByZXNwb25zZUJ1ZiA9IG5ldyBCaW5hcnlXcml0ZXIoXG4gICAgICBic2F0bkJhc2VTaXplKG1vZHVsZUN0eC50eXBlc3BhY2UsIEh0dHBSZXNwb25zZS5hbGdlYnJhaWNUeXBlKVxuICAgICk7XG4gICAgSHR0cFJlc3BvbnNlLnNlcmlhbGl6ZShyZXNwb25zZUJ1ZiwgcmVzcG9uc2VNZXRhZGF0YSk7XG4gICAgcmV0dXJuIFtyZXNwb25zZUJ1Zi5nZXRCdWZmZXIoKSwgcmVzcG9uc2VCb2R5XTtcbiAgfVxufTtcbnZhciBCSU5BUllfV1JJVEVSID0gbmV3IEJpbmFyeVdyaXRlcigwKTtcbnZhciBCSU5BUllfUkVBREVSID0gbmV3IEJpbmFyeVJlYWRlcihuZXcgVWludDhBcnJheSgpKTtcbnZhciBIYW5kbGVyQ29udGV4dEltcGwgPSBjbGFzcyB7XG4gIGNvbnN0cnVjdG9yKHRpbWVzdGFtcCwgZGJWaWV3KSB7XG4gICAgdGhpcy50aW1lc3RhbXAgPSB0aW1lc3RhbXA7XG4gICAgdGhpcy4jZGJWaWV3ID0gZGJWaWV3O1xuICB9XG4gICNpZGVudGl0eTtcbiAgI3V1aWRDb3VudGVyO1xuICAjcmFuZG9tO1xuICAjZGJWaWV3O1xuICBodHRwID0gaHR0cENsaWVudDtcbiAgZ2V0IGlkZW50aXR5KCkge1xuICAgIHJldHVybiB0aGlzLiNpZGVudGl0eSA/Pz0gbmV3IElkZW50aXR5KHN5cy5pZGVudGl0eSgpKTtcbiAgfVxuICBnZXQgcmFuZG9tKCkge1xuICAgIHJldHVybiB0aGlzLiNyYW5kb20gPz89IG1ha2VSYW5kb20odGhpcy50aW1lc3RhbXApO1xuICB9XG4gIHdpdGhUeChib2R5KSB7XG4gICAgcmV0dXJuIHJ1bldpdGhUeChcbiAgICAgICh0aW1lc3RhbXApID0+IG5ldyBSZWR1Y2VyQ3R4SW1wbChJZGVudGl0eS56ZXJvKCksIHRpbWVzdGFtcCwgbnVsbCwgdGhpcy4jZGJWaWV3KCkpLFxuICAgICAgYm9keVxuICAgICk7XG4gIH1cbiAgbmV3VXVpZFY0KCkge1xuICAgIGNvbnN0IGJ5dGVzID0gdGhpcy5yYW5kb20uZmlsbChuZXcgVWludDhBcnJheSgxNikpO1xuICAgIHJldHVybiBVdWlkLmZyb21SYW5kb21CeXRlc1Y0KGJ5dGVzKTtcbiAgfVxuICBuZXdVdWlkVjcoKSB7XG4gICAgY29uc3QgYnl0ZXMgPSB0aGlzLnJhbmRvbS5maWxsKG5ldyBVaW50OEFycmF5KDQpKTtcbiAgICBjb25zdCBjb3VudGVyID0gdGhpcy4jdXVpZENvdW50ZXIgPz89IHsgdmFsdWU6IDAgfTtcbiAgICByZXR1cm4gVXVpZC5mcm9tQ291bnRlclY3KGNvdW50ZXIsIHRoaXMudGltZXN0YW1wLCBieXRlcyk7XG4gIH1cbn07XG5mdW5jdGlvbiBtYWtlVGFibGVWaWV3KHR5cGVzcGFjZSwgdGFibGUyKSB7XG4gIGNvbnN0IHRhYmxlX2lkID0gc3lzLnRhYmxlX2lkX2Zyb21fbmFtZSh0YWJsZTIuc291cmNlTmFtZSk7XG4gIGNvbnN0IHJvd1R5cGUgPSB0eXBlc3BhY2UudHlwZXNbdGFibGUyLnByb2R1Y3RUeXBlUmVmXTtcbiAgaWYgKHJvd1R5cGUudGFnICE9PSBcIlByb2R1Y3RcIikge1xuICAgIHRocm93IFwiaW1wb3NzaWJsZVwiO1xuICB9XG4gIGNvbnN0IHNlcmlhbGl6ZVJvdyA9IEFsZ2VicmFpY1R5cGUubWFrZVNlcmlhbGl6ZXIocm93VHlwZSwgdHlwZXNwYWNlKTtcbiAgY29uc3QgZGVzZXJpYWxpemVSb3cgPSBBbGdlYnJhaWNUeXBlLm1ha2VEZXNlcmlhbGl6ZXIocm93VHlwZSwgdHlwZXNwYWNlKTtcbiAgY29uc3Qgc2VxdWVuY2VzID0gdGFibGUyLnNlcXVlbmNlcy5tYXAoKHNlcSkgPT4ge1xuICAgIGNvbnN0IGNvbCA9IHJvd1R5cGUudmFsdWUuZWxlbWVudHNbc2VxLmNvbHVtbl07XG4gICAgY29uc3QgY29sVHlwZSA9IGNvbC5hbGdlYnJhaWNUeXBlO1xuICAgIGxldCBzZXF1ZW5jZVRyaWdnZXI7XG4gICAgc3dpdGNoIChjb2xUeXBlLnRhZykge1xuICAgICAgY2FzZSBcIlU4XCI6XG4gICAgICBjYXNlIFwiSThcIjpcbiAgICAgIGNhc2UgXCJVMTZcIjpcbiAgICAgIGNhc2UgXCJJMTZcIjpcbiAgICAgIGNhc2UgXCJVMzJcIjpcbiAgICAgIGNhc2UgXCJJMzJcIjpcbiAgICAgICAgc2VxdWVuY2VUcmlnZ2VyID0gMDtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwiVTY0XCI6XG4gICAgICBjYXNlIFwiSTY0XCI6XG4gICAgICBjYXNlIFwiVTEyOFwiOlxuICAgICAgY2FzZSBcIkkxMjhcIjpcbiAgICAgIGNhc2UgXCJVMjU2XCI6XG4gICAgICBjYXNlIFwiSTI1NlwiOlxuICAgICAgICBzZXF1ZW5jZVRyaWdnZXIgPSAwbjtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiaW52YWxpZCBzZXF1ZW5jZSB0eXBlXCIpO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgY29sTmFtZTogY29sLm5hbWUsXG4gICAgICBzZXF1ZW5jZVRyaWdnZXIsXG4gICAgICBkZXNlcmlhbGl6ZTogQWxnZWJyYWljVHlwZS5tYWtlRGVzZXJpYWxpemVyKGNvbFR5cGUsIHR5cGVzcGFjZSlcbiAgICB9O1xuICB9KTtcbiAgY29uc3QgaGFzQXV0b0luY3JlbWVudCA9IHNlcXVlbmNlcy5sZW5ndGggPiAwO1xuICBjb25zdCBpdGVyID0gKCkgPT4gdGFibGVJdGVyYXRvcihzeXMuZGF0YXN0b3JlX3RhYmxlX3NjYW5fYnNhdG4odGFibGVfaWQpLCBkZXNlcmlhbGl6ZVJvdyk7XG4gIGNvbnN0IGludGVncmF0ZUdlbmVyYXRlZENvbHVtbnMgPSBoYXNBdXRvSW5jcmVtZW50ID8gKHJvdywgcmV0X2J1ZikgPT4ge1xuICAgIEJJTkFSWV9SRUFERVIucmVzZXQocmV0X2J1Zik7XG4gICAgZm9yIChjb25zdCB7IGNvbE5hbWUsIGRlc2VyaWFsaXplLCBzZXF1ZW5jZVRyaWdnZXIgfSBvZiBzZXF1ZW5jZXMpIHtcbiAgICAgIGlmIChyb3dbY29sTmFtZV0gPT09IHNlcXVlbmNlVHJpZ2dlcikge1xuICAgICAgICByb3dbY29sTmFtZV0gPSBkZXNlcmlhbGl6ZShCSU5BUllfUkVBREVSKTtcbiAgICAgIH1cbiAgICB9XG4gIH0gOiBudWxsO1xuICBjb25zdCB0YWJsZU1ldGhvZHMgPSB7XG4gICAgY291bnQ6ICgpID0+IHN5cy5kYXRhc3RvcmVfdGFibGVfcm93X2NvdW50KHRhYmxlX2lkKSxcbiAgICBpdGVyLFxuICAgIFtTeW1ib2wuaXRlcmF0b3JdOiAoKSA9PiBpdGVyKCksXG4gICAgaW5zZXJ0OiAocm93KSA9PiB7XG4gICAgICBjb25zdCBidWYgPSBMRUFGX0JVRjtcbiAgICAgIEJJTkFSWV9XUklURVIucmVzZXQoYnVmKTtcbiAgICAgIHNlcmlhbGl6ZVJvdyhCSU5BUllfV1JJVEVSLCByb3cpO1xuICAgICAgc3lzLmRhdGFzdG9yZV9pbnNlcnRfYnNhdG4odGFibGVfaWQsIGJ1Zi5idWZmZXIsIEJJTkFSWV9XUklURVIub2Zmc2V0KTtcbiAgICAgIGNvbnN0IHJldCA9IHsgLi4ucm93IH07XG4gICAgICBpbnRlZ3JhdGVHZW5lcmF0ZWRDb2x1bW5zPy4ocmV0LCBidWYudmlldyk7XG4gICAgICByZXR1cm4gcmV0O1xuICAgIH0sXG4gICAgZGVsZXRlOiAocm93KSA9PiB7XG4gICAgICBjb25zdCBidWYgPSBMRUFGX0JVRjtcbiAgICAgIEJJTkFSWV9XUklURVIucmVzZXQoYnVmKTtcbiAgICAgIEJJTkFSWV9XUklURVIud3JpdGVVMzIoMSk7XG4gICAgICBzZXJpYWxpemVSb3coQklOQVJZX1dSSVRFUiwgcm93KTtcbiAgICAgIGNvbnN0IGNvdW50ID0gc3lzLmRhdGFzdG9yZV9kZWxldGVfYWxsX2J5X2VxX2JzYXRuKFxuICAgICAgICB0YWJsZV9pZCxcbiAgICAgICAgYnVmLmJ1ZmZlcixcbiAgICAgICAgQklOQVJZX1dSSVRFUi5vZmZzZXRcbiAgICAgICk7XG4gICAgICByZXR1cm4gY291bnQgPiAwO1xuICAgIH0sXG4gICAgY2xlYXI6ICgpID0+IHN5cy5kYXRhc3RvcmVfY2xlYXIodGFibGVfaWQpXG4gIH07XG4gIGNvbnN0IHRhYmxlVmlldyA9IE9iamVjdC5hc3NpZ24oXG4gICAgLyogQF9fUFVSRV9fICovIE9iamVjdC5jcmVhdGUobnVsbCksXG4gICAgdGFibGVNZXRob2RzXG4gICk7XG4gIGZvciAoY29uc3QgaW5kZXhEZWYgb2YgdGFibGUyLmluZGV4ZXMpIHtcbiAgICBjb25zdCBhY2Nlc3Nvck5hbWUgPSBpbmRleERlZi5hY2Nlc3Nvck5hbWU7XG4gICAgY29uc3QgaW5kZXhfaWQgPSBzeXMuaW5kZXhfaWRfZnJvbV9uYW1lKGluZGV4RGVmLnNvdXJjZU5hbWUpO1xuICAgIGxldCBjb2x1bW5faWRzO1xuICAgIGxldCBpc0hhc2hJbmRleCA9IGZhbHNlO1xuICAgIHN3aXRjaCAoaW5kZXhEZWYuYWxnb3JpdGhtLnRhZykge1xuICAgICAgY2FzZSBcIkhhc2hcIjpcbiAgICAgICAgaXNIYXNoSW5kZXggPSB0cnVlO1xuICAgICAgICBjb2x1bW5faWRzID0gaW5kZXhEZWYuYWxnb3JpdGhtLnZhbHVlO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJCVHJlZVwiOlxuICAgICAgICBjb2x1bW5faWRzID0gaW5kZXhEZWYuYWxnb3JpdGhtLnZhbHVlO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJEaXJlY3RcIjpcbiAgICAgICAgY29sdW1uX2lkcyA9IFtpbmRleERlZi5hbGdvcml0aG0udmFsdWVdO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gICAgY29uc3QgbnVtQ29sdW1ucyA9IGNvbHVtbl9pZHMubGVuZ3RoO1xuICAgIGNvbnN0IGNvbHVtblNldCA9IG5ldyBTZXQoY29sdW1uX2lkcyk7XG4gICAgY29uc3QgaXNVbmlxdWUgPSB0YWJsZTIuY29uc3RyYWludHMuZmlsdGVyKCh4KSA9PiB4LmRhdGEudGFnID09PSBcIlVuaXF1ZVwiKS5zb21lKCh4KSA9PiBjb2x1bW5TZXQuaXNTdWJzZXRPZihuZXcgU2V0KHguZGF0YS52YWx1ZS5jb2x1bW5zKSkpO1xuICAgIGNvbnN0IGlzUHJpbWFyeUtleSA9IGlzVW5pcXVlICYmIGNvbHVtbl9pZHMubGVuZ3RoID09PSB0YWJsZTIucHJpbWFyeUtleS5sZW5ndGggJiYgY29sdW1uX2lkcy5ldmVyeSgoaWQsIGkpID0+IHRhYmxlMi5wcmltYXJ5S2V5W2ldID09PSBpZCk7XG4gICAgY29uc3QgaW5kZXhTZXJpYWxpemVycyA9IGNvbHVtbl9pZHMubWFwKFxuICAgICAgKGlkKSA9PiBBbGdlYnJhaWNUeXBlLm1ha2VTZXJpYWxpemVyKFxuICAgICAgICByb3dUeXBlLnZhbHVlLmVsZW1lbnRzW2lkXS5hbGdlYnJhaWNUeXBlLFxuICAgICAgICB0eXBlc3BhY2VcbiAgICAgIClcbiAgICApO1xuICAgIGNvbnN0IHNlcmlhbGl6ZVBvaW50ID0gKGJ1ZmZlciwgY29sVmFsKSA9PiB7XG4gICAgICBCSU5BUllfV1JJVEVSLnJlc2V0KGJ1ZmZlcik7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG51bUNvbHVtbnM7IGkrKykge1xuICAgICAgICBpbmRleFNlcmlhbGl6ZXJzW2ldKEJJTkFSWV9XUklURVIsIGNvbFZhbFtpXSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gQklOQVJZX1dSSVRFUi5vZmZzZXQ7XG4gICAgfTtcbiAgICBjb25zdCBzZXJpYWxpemVTaW5nbGVFbGVtZW50ID0gbnVtQ29sdW1ucyA9PT0gMSA/IGluZGV4U2VyaWFsaXplcnNbMF0gOiBudWxsO1xuICAgIGNvbnN0IHNlcmlhbGl6ZVNpbmdsZVBvaW50ID0gc2VyaWFsaXplU2luZ2xlRWxlbWVudCAmJiAoKGJ1ZmZlciwgY29sVmFsKSA9PiB7XG4gICAgICBCSU5BUllfV1JJVEVSLnJlc2V0KGJ1ZmZlcik7XG4gICAgICBzZXJpYWxpemVTaW5nbGVFbGVtZW50KEJJTkFSWV9XUklURVIsIGNvbFZhbCk7XG4gICAgICByZXR1cm4gQklOQVJZX1dSSVRFUi5vZmZzZXQ7XG4gICAgfSk7XG4gICAgbGV0IGluZGV4O1xuICAgIGlmIChpc1VuaXF1ZSAmJiBzZXJpYWxpemVTaW5nbGVQb2ludCkge1xuICAgICAgY29uc3QgYmFzZSA9IHtcbiAgICAgICAgZmluZDogKGNvbFZhbCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGJ1ZiA9IExFQUZfQlVGO1xuICAgICAgICAgIGNvbnN0IHBvaW50X2xlbiA9IHNlcmlhbGl6ZVNpbmdsZVBvaW50KGJ1ZiwgY29sVmFsKTtcbiAgICAgICAgICBjb25zdCBpdGVyX2lkID0gc3lzLmRhdGFzdG9yZV9pbmRleF9zY2FuX3BvaW50X2JzYXRuKFxuICAgICAgICAgICAgaW5kZXhfaWQsXG4gICAgICAgICAgICBidWYuYnVmZmVyLFxuICAgICAgICAgICAgcG9pbnRfbGVuXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4gdGFibGVJdGVyYXRlT25lKGl0ZXJfaWQsIGRlc2VyaWFsaXplUm93KTtcbiAgICAgICAgfSxcbiAgICAgICAgZGVsZXRlOiAoY29sVmFsKSA9PiB7XG4gICAgICAgICAgY29uc3QgYnVmID0gTEVBRl9CVUY7XG4gICAgICAgICAgY29uc3QgcG9pbnRfbGVuID0gc2VyaWFsaXplU2luZ2xlUG9pbnQoYnVmLCBjb2xWYWwpO1xuICAgICAgICAgIGNvbnN0IG51bSA9IHN5cy5kYXRhc3RvcmVfZGVsZXRlX2J5X2luZGV4X3NjYW5fcG9pbnRfYnNhdG4oXG4gICAgICAgICAgICBpbmRleF9pZCxcbiAgICAgICAgICAgIGJ1Zi5idWZmZXIsXG4gICAgICAgICAgICBwb2ludF9sZW5cbiAgICAgICAgICApO1xuICAgICAgICAgIHJldHVybiBudW0gPiAwO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgaWYgKGlzUHJpbWFyeUtleSkge1xuICAgICAgICBiYXNlLnVwZGF0ZSA9IChyb3cpID0+IHtcbiAgICAgICAgICBjb25zdCBidWYgPSBMRUFGX0JVRjtcbiAgICAgICAgICBCSU5BUllfV1JJVEVSLnJlc2V0KGJ1Zik7XG4gICAgICAgICAgc2VyaWFsaXplUm93KEJJTkFSWV9XUklURVIsIHJvdyk7XG4gICAgICAgICAgc3lzLmRhdGFzdG9yZV91cGRhdGVfYnNhdG4oXG4gICAgICAgICAgICB0YWJsZV9pZCxcbiAgICAgICAgICAgIGluZGV4X2lkLFxuICAgICAgICAgICAgYnVmLmJ1ZmZlcixcbiAgICAgICAgICAgIEJJTkFSWV9XUklURVIub2Zmc2V0XG4gICAgICAgICAgKTtcbiAgICAgICAgICBpbnRlZ3JhdGVHZW5lcmF0ZWRDb2x1bW5zPy4ocm93LCBidWYudmlldyk7XG4gICAgICAgICAgcmV0dXJuIHJvdztcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGluZGV4ID0gYmFzZTtcbiAgICB9IGVsc2UgaWYgKGlzVW5pcXVlKSB7XG4gICAgICBjb25zdCBiYXNlID0ge1xuICAgICAgICBmaW5kOiAoY29sVmFsKSA9PiB7XG4gICAgICAgICAgaWYgKGNvbFZhbC5sZW5ndGggIT09IG51bUNvbHVtbnMpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJ3cm9uZyBudW1iZXIgb2YgZWxlbWVudHNcIik7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IGJ1ZiA9IExFQUZfQlVGO1xuICAgICAgICAgIGNvbnN0IHBvaW50X2xlbiA9IHNlcmlhbGl6ZVBvaW50KGJ1ZiwgY29sVmFsKTtcbiAgICAgICAgICBjb25zdCBpdGVyX2lkID0gc3lzLmRhdGFzdG9yZV9pbmRleF9zY2FuX3BvaW50X2JzYXRuKFxuICAgICAgICAgICAgaW5kZXhfaWQsXG4gICAgICAgICAgICBidWYuYnVmZmVyLFxuICAgICAgICAgICAgcG9pbnRfbGVuXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4gdGFibGVJdGVyYXRlT25lKGl0ZXJfaWQsIGRlc2VyaWFsaXplUm93KTtcbiAgICAgICAgfSxcbiAgICAgICAgZGVsZXRlOiAoY29sVmFsKSA9PiB7XG4gICAgICAgICAgaWYgKGNvbFZhbC5sZW5ndGggIT09IG51bUNvbHVtbnMpXG4gICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwid3JvbmcgbnVtYmVyIG9mIGVsZW1lbnRzXCIpO1xuICAgICAgICAgIGNvbnN0IGJ1ZiA9IExFQUZfQlVGO1xuICAgICAgICAgIGNvbnN0IHBvaW50X2xlbiA9IHNlcmlhbGl6ZVBvaW50KGJ1ZiwgY29sVmFsKTtcbiAgICAgICAgICBjb25zdCBudW0gPSBzeXMuZGF0YXN0b3JlX2RlbGV0ZV9ieV9pbmRleF9zY2FuX3BvaW50X2JzYXRuKFxuICAgICAgICAgICAgaW5kZXhfaWQsXG4gICAgICAgICAgICBidWYuYnVmZmVyLFxuICAgICAgICAgICAgcG9pbnRfbGVuXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4gbnVtID4gMDtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGlmIChpc1ByaW1hcnlLZXkpIHtcbiAgICAgICAgYmFzZS51cGRhdGUgPSAocm93KSA9PiB7XG4gICAgICAgICAgY29uc3QgYnVmID0gTEVBRl9CVUY7XG4gICAgICAgICAgQklOQVJZX1dSSVRFUi5yZXNldChidWYpO1xuICAgICAgICAgIHNlcmlhbGl6ZVJvdyhCSU5BUllfV1JJVEVSLCByb3cpO1xuICAgICAgICAgIHN5cy5kYXRhc3RvcmVfdXBkYXRlX2JzYXRuKFxuICAgICAgICAgICAgdGFibGVfaWQsXG4gICAgICAgICAgICBpbmRleF9pZCxcbiAgICAgICAgICAgIGJ1Zi5idWZmZXIsXG4gICAgICAgICAgICBCSU5BUllfV1JJVEVSLm9mZnNldFxuICAgICAgICAgICk7XG4gICAgICAgICAgaW50ZWdyYXRlR2VuZXJhdGVkQ29sdW1ucz8uKHJvdywgYnVmLnZpZXcpO1xuICAgICAgICAgIHJldHVybiByb3c7XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBpbmRleCA9IGJhc2U7XG4gICAgfSBlbHNlIGlmIChzZXJpYWxpemVTaW5nbGVQb2ludCkge1xuICAgICAgY29uc3Qgc2VyaWFsaXplU2luZ2xlUmFuZ2UgPSAhaXNIYXNoSW5kZXggPyAoYnVmZmVyLCByYW5nZSkgPT4ge1xuICAgICAgICBCSU5BUllfV1JJVEVSLnJlc2V0KGJ1ZmZlcik7XG4gICAgICAgIGNvbnN0IHdyaXRlciA9IEJJTkFSWV9XUklURVI7XG4gICAgICAgIGNvbnN0IHdyaXRlQm91bmQgPSAoYm91bmQpID0+IHtcbiAgICAgICAgICBjb25zdCB0YWdzID0geyBpbmNsdWRlZDogMCwgZXhjbHVkZWQ6IDEsIHVuYm91bmRlZDogMiB9O1xuICAgICAgICAgIHdyaXRlci53cml0ZVU4KHRhZ3NbYm91bmQudGFnXSk7XG4gICAgICAgICAgaWYgKGJvdW5kLnRhZyAhPT0gXCJ1bmJvdW5kZWRcIilcbiAgICAgICAgICAgIHNlcmlhbGl6ZVNpbmdsZUVsZW1lbnQod3JpdGVyLCBib3VuZC52YWx1ZSk7XG4gICAgICAgIH07XG4gICAgICAgIHdyaXRlQm91bmQocmFuZ2UuZnJvbSk7XG4gICAgICAgIGNvbnN0IHJzdGFydExlbiA9IHdyaXRlci5vZmZzZXQ7XG4gICAgICAgIHdyaXRlQm91bmQocmFuZ2UudG8pO1xuICAgICAgICBjb25zdCByZW5kTGVuID0gd3JpdGVyLm9mZnNldCAtIHJzdGFydExlbjtcbiAgICAgICAgcmV0dXJuIFswLCAwLCByc3RhcnRMZW4sIHJlbmRMZW5dO1xuICAgICAgfSA6IG51bGw7XG4gICAgICBjb25zdCByYXdJbmRleCA9IHtcbiAgICAgICAgZmlsdGVyOiAocmFuZ2UpID0+IHtcbiAgICAgICAgICBjb25zdCBidWYgPSBMRUFGX0JVRjtcbiAgICAgICAgICBpZiAoc2VyaWFsaXplU2luZ2xlUmFuZ2UgJiYgcmFuZ2UgaW5zdGFuY2VvZiBSYW5nZSkge1xuICAgICAgICAgICAgY29uc3QgYXJncyA9IHNlcmlhbGl6ZVNpbmdsZVJhbmdlKGJ1ZiwgcmFuZ2UpO1xuICAgICAgICAgICAgY29uc3QgaXRlcl9pZDIgPSBzeXMuZGF0YXN0b3JlX2luZGV4X3NjYW5fcmFuZ2VfYnNhdG4oXG4gICAgICAgICAgICAgIGluZGV4X2lkLFxuICAgICAgICAgICAgICBidWYuYnVmZmVyLFxuICAgICAgICAgICAgICAuLi5hcmdzXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgcmV0dXJuIHRhYmxlSXRlcmF0b3IoaXRlcl9pZDIsIGRlc2VyaWFsaXplUm93KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgcG9pbnRfbGVuID0gc2VyaWFsaXplU2luZ2xlUG9pbnQoYnVmLCByYW5nZSk7XG4gICAgICAgICAgY29uc3QgaXRlcl9pZCA9IHN5cy5kYXRhc3RvcmVfaW5kZXhfc2Nhbl9wb2ludF9ic2F0bihcbiAgICAgICAgICAgIGluZGV4X2lkLFxuICAgICAgICAgICAgYnVmLmJ1ZmZlcixcbiAgICAgICAgICAgIHBvaW50X2xlblxuICAgICAgICAgICk7XG4gICAgICAgICAgcmV0dXJuIHRhYmxlSXRlcmF0b3IoaXRlcl9pZCwgZGVzZXJpYWxpemVSb3cpO1xuICAgICAgICB9LFxuICAgICAgICBkZWxldGU6IChyYW5nZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGJ1ZiA9IExFQUZfQlVGO1xuICAgICAgICAgIGlmIChzZXJpYWxpemVTaW5nbGVSYW5nZSAmJiByYW5nZSBpbnN0YW5jZW9mIFJhbmdlKSB7XG4gICAgICAgICAgICBjb25zdCBhcmdzID0gc2VyaWFsaXplU2luZ2xlUmFuZ2UoYnVmLCByYW5nZSk7XG4gICAgICAgICAgICByZXR1cm4gc3lzLmRhdGFzdG9yZV9kZWxldGVfYnlfaW5kZXhfc2Nhbl9yYW5nZV9ic2F0bihcbiAgICAgICAgICAgICAgaW5kZXhfaWQsXG4gICAgICAgICAgICAgIGJ1Zi5idWZmZXIsXG4gICAgICAgICAgICAgIC4uLmFyZ3NcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IHBvaW50X2xlbiA9IHNlcmlhbGl6ZVNpbmdsZVBvaW50KGJ1ZiwgcmFuZ2UpO1xuICAgICAgICAgIHJldHVybiBzeXMuZGF0YXN0b3JlX2RlbGV0ZV9ieV9pbmRleF9zY2FuX3BvaW50X2JzYXRuKFxuICAgICAgICAgICAgaW5kZXhfaWQsXG4gICAgICAgICAgICBidWYuYnVmZmVyLFxuICAgICAgICAgICAgcG9pbnRfbGVuXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGlmIChpc0hhc2hJbmRleCkge1xuICAgICAgICBpbmRleCA9IHJhd0luZGV4O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaW5kZXggPSByYXdJbmRleDtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGlzSGFzaEluZGV4KSB7XG4gICAgICBpbmRleCA9IHtcbiAgICAgICAgZmlsdGVyOiAocmFuZ2UpID0+IHtcbiAgICAgICAgICBjb25zdCBidWYgPSBMRUFGX0JVRjtcbiAgICAgICAgICBjb25zdCBwb2ludF9sZW4gPSBzZXJpYWxpemVQb2ludChidWYsIHJhbmdlKTtcbiAgICAgICAgICBjb25zdCBpdGVyX2lkID0gc3lzLmRhdGFzdG9yZV9pbmRleF9zY2FuX3BvaW50X2JzYXRuKFxuICAgICAgICAgICAgaW5kZXhfaWQsXG4gICAgICAgICAgICBidWYuYnVmZmVyLFxuICAgICAgICAgICAgcG9pbnRfbGVuXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm4gdGFibGVJdGVyYXRvcihpdGVyX2lkLCBkZXNlcmlhbGl6ZVJvdyk7XG4gICAgICAgIH0sXG4gICAgICAgIGRlbGV0ZTogKHJhbmdlKSA9PiB7XG4gICAgICAgICAgY29uc3QgYnVmID0gTEVBRl9CVUY7XG4gICAgICAgICAgY29uc3QgcG9pbnRfbGVuID0gc2VyaWFsaXplUG9pbnQoYnVmLCByYW5nZSk7XG4gICAgICAgICAgcmV0dXJuIHN5cy5kYXRhc3RvcmVfZGVsZXRlX2J5X2luZGV4X3NjYW5fcG9pbnRfYnNhdG4oXG4gICAgICAgICAgICBpbmRleF9pZCxcbiAgICAgICAgICAgIGJ1Zi5idWZmZXIsXG4gICAgICAgICAgICBwb2ludF9sZW5cbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBzZXJpYWxpemVSYW5nZSA9IChidWZmZXIsIHJhbmdlKSA9PiB7XG4gICAgICAgIGlmIChyYW5nZS5sZW5ndGggPiBudW1Db2x1bW5zKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwidG9vIG1hbnkgZWxlbWVudHNcIik7XG4gICAgICAgIEJJTkFSWV9XUklURVIucmVzZXQoYnVmZmVyKTtcbiAgICAgICAgY29uc3Qgd3JpdGVyID0gQklOQVJZX1dSSVRFUjtcbiAgICAgICAgY29uc3QgcHJlZml4X2VsZW1zID0gcmFuZ2UubGVuZ3RoIC0gMTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwcmVmaXhfZWxlbXM7IGkrKykge1xuICAgICAgICAgIGluZGV4U2VyaWFsaXplcnNbaV0od3JpdGVyLCByYW5nZVtpXSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcnN0YXJ0T2Zmc2V0ID0gd3JpdGVyLm9mZnNldDtcbiAgICAgICAgY29uc3QgdGVybSA9IHJhbmdlW3JhbmdlLmxlbmd0aCAtIDFdO1xuICAgICAgICBjb25zdCBzZXJpYWxpemVUZXJtID0gaW5kZXhTZXJpYWxpemVyc1tyYW5nZS5sZW5ndGggLSAxXTtcbiAgICAgICAgaWYgKHRlcm0gaW5zdGFuY2VvZiBSYW5nZSkge1xuICAgICAgICAgIGNvbnN0IHdyaXRlQm91bmQgPSAoYm91bmQpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRhZ3MgPSB7IGluY2x1ZGVkOiAwLCBleGNsdWRlZDogMSwgdW5ib3VuZGVkOiAyIH07XG4gICAgICAgICAgICB3cml0ZXIud3JpdGVVOCh0YWdzW2JvdW5kLnRhZ10pO1xuICAgICAgICAgICAgaWYgKGJvdW5kLnRhZyAhPT0gXCJ1bmJvdW5kZWRcIikgc2VyaWFsaXplVGVybSh3cml0ZXIsIGJvdW5kLnZhbHVlKTtcbiAgICAgICAgICB9O1xuICAgICAgICAgIHdyaXRlQm91bmQodGVybS5mcm9tKTtcbiAgICAgICAgICBjb25zdCByc3RhcnRMZW4gPSB3cml0ZXIub2Zmc2V0IC0gcnN0YXJ0T2Zmc2V0O1xuICAgICAgICAgIHdyaXRlQm91bmQodGVybS50byk7XG4gICAgICAgICAgY29uc3QgcmVuZExlbiA9IHdyaXRlci5vZmZzZXQgLSByc3RhcnRMZW47XG4gICAgICAgICAgcmV0dXJuIFtyc3RhcnRPZmZzZXQsIHByZWZpeF9lbGVtcywgcnN0YXJ0TGVuLCByZW5kTGVuXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB3cml0ZXIud3JpdGVVOCgwKTtcbiAgICAgICAgICBzZXJpYWxpemVUZXJtKHdyaXRlciwgdGVybSk7XG4gICAgICAgICAgY29uc3QgcnN0YXJ0TGVuID0gd3JpdGVyLm9mZnNldDtcbiAgICAgICAgICBjb25zdCByZW5kTGVuID0gMDtcbiAgICAgICAgICByZXR1cm4gW3JzdGFydE9mZnNldCwgcHJlZml4X2VsZW1zLCByc3RhcnRMZW4sIHJlbmRMZW5dO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgaW5kZXggPSB7XG4gICAgICAgIGZpbHRlcjogKHJhbmdlKSA9PiB7XG4gICAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJhbmdlKSkgcmFuZ2UgPSBbcmFuZ2VdO1xuICAgICAgICAgIGlmIChyYW5nZS5sZW5ndGggPT09IG51bUNvbHVtbnMpIHtcbiAgICAgICAgICAgIGNvbnN0IGJ1ZiA9IExFQUZfQlVGO1xuICAgICAgICAgICAgY29uc3QgcG9pbnRfbGVuID0gc2VyaWFsaXplUG9pbnQoYnVmLCByYW5nZSk7XG4gICAgICAgICAgICBjb25zdCBpdGVyX2lkID0gc3lzLmRhdGFzdG9yZV9pbmRleF9zY2FuX3BvaW50X2JzYXRuKFxuICAgICAgICAgICAgICBpbmRleF9pZCxcbiAgICAgICAgICAgICAgYnVmLmJ1ZmZlcixcbiAgICAgICAgICAgICAgcG9pbnRfbGVuXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgcmV0dXJuIHRhYmxlSXRlcmF0b3IoaXRlcl9pZCwgZGVzZXJpYWxpemVSb3cpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBidWYgPSBMRUFGX0JVRjtcbiAgICAgICAgICAgIGNvbnN0IGFyZ3MgPSBzZXJpYWxpemVSYW5nZShidWYsIHJhbmdlKTtcbiAgICAgICAgICAgIGNvbnN0IGl0ZXJfaWQgPSBzeXMuZGF0YXN0b3JlX2luZGV4X3NjYW5fcmFuZ2VfYnNhdG4oXG4gICAgICAgICAgICAgIGluZGV4X2lkLFxuICAgICAgICAgICAgICBidWYuYnVmZmVyLFxuICAgICAgICAgICAgICAuLi5hcmdzXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgcmV0dXJuIHRhYmxlSXRlcmF0b3IoaXRlcl9pZCwgZGVzZXJpYWxpemVSb3cpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgZGVsZXRlOiAocmFuZ2UpID0+IHtcbiAgICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkocmFuZ2UpKSByYW5nZSA9IFtyYW5nZV07XG4gICAgICAgICAgaWYgKHJhbmdlLmxlbmd0aCA9PT0gbnVtQ29sdW1ucykge1xuICAgICAgICAgICAgY29uc3QgYnVmID0gTEVBRl9CVUY7XG4gICAgICAgICAgICBjb25zdCBwb2ludF9sZW4gPSBzZXJpYWxpemVQb2ludChidWYsIHJhbmdlKTtcbiAgICAgICAgICAgIHJldHVybiBzeXMuZGF0YXN0b3JlX2RlbGV0ZV9ieV9pbmRleF9zY2FuX3BvaW50X2JzYXRuKFxuICAgICAgICAgICAgICBpbmRleF9pZCxcbiAgICAgICAgICAgICAgYnVmLmJ1ZmZlcixcbiAgICAgICAgICAgICAgcG9pbnRfbGVuXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBidWYgPSBMRUFGX0JVRjtcbiAgICAgICAgICAgIGNvbnN0IGFyZ3MgPSBzZXJpYWxpemVSYW5nZShidWYsIHJhbmdlKTtcbiAgICAgICAgICAgIHJldHVybiBzeXMuZGF0YXN0b3JlX2RlbGV0ZV9ieV9pbmRleF9zY2FuX3JhbmdlX2JzYXRuKFxuICAgICAgICAgICAgICBpbmRleF9pZCxcbiAgICAgICAgICAgICAgYnVmLmJ1ZmZlcixcbiAgICAgICAgICAgICAgLi4uYXJnc1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgfVxuICAgIGlmIChPYmplY3QuaGFzT3duKHRhYmxlVmlldywgYWNjZXNzb3JOYW1lKSkge1xuICAgICAgZnJlZXplKE9iamVjdC5hc3NpZ24odGFibGVWaWV3W2FjY2Vzc29yTmFtZV0sIGluZGV4KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRhYmxlVmlld1thY2Nlc3Nvck5hbWVdID0gZnJlZXplKGluZGV4KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZyZWV6ZSh0YWJsZVZpZXcpO1xufVxuZnVuY3Rpb24qIHRhYmxlSXRlcmF0b3IoaWQsIGRlc2VyaWFsaXplKSB7XG4gIHVzaW5nIGl0ZXIgPSBuZXcgSXRlcmF0b3JIYW5kbGUoaWQpO1xuICBjb25zdCBpdGVyQnVmID0gdGFrZUJ1ZigpO1xuICB0cnkge1xuICAgIGxldCBhbXQ7XG4gICAgd2hpbGUgKGFtdCA9IGl0ZXIuYWR2YW5jZShpdGVyQnVmKSkge1xuICAgICAgY29uc3QgcmVhZGVyID0gbmV3IEJpbmFyeVJlYWRlcihpdGVyQnVmLnZpZXcpO1xuICAgICAgd2hpbGUgKHJlYWRlci5vZmZzZXQgPCBhbXQpIHtcbiAgICAgICAgeWllbGQgZGVzZXJpYWxpemUocmVhZGVyKTtcbiAgICAgIH1cbiAgICB9XG4gIH0gZmluYWxseSB7XG4gICAgcmV0dXJuQnVmKGl0ZXJCdWYpO1xuICB9XG59XG5mdW5jdGlvbiB0YWJsZUl0ZXJhdGVPbmUoaWQsIGRlc2VyaWFsaXplKSB7XG4gIGNvbnN0IGJ1ZiA9IExFQUZfQlVGO1xuICBjb25zdCByZXQgPSBhZHZhbmNlSXRlclJhdyhpZCwgYnVmKTtcbiAgaWYgKHJldCAhPT0gMCkge1xuICAgIEJJTkFSWV9SRUFERVIucmVzZXQoYnVmLnZpZXcpO1xuICAgIHJldHVybiBkZXNlcmlhbGl6ZShCSU5BUllfUkVBREVSKTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cbmZ1bmN0aW9uIGFkdmFuY2VJdGVyUmF3KGlkLCBidWYpIHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIDAgfCBzeXMucm93X2l0ZXJfYnNhdG5fYWR2YW5jZShpZCwgYnVmLmJ1ZmZlcik7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaWYgKGUgJiYgdHlwZW9mIGUgPT09IFwib2JqZWN0XCIgJiYgaGFzT3duKGUsIFwiX19idWZmZXJfdG9vX3NtYWxsX19cIikpIHtcbiAgICAgICAgYnVmLmdyb3coZS5fX2J1ZmZlcl90b29fc21hbGxfXyk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH1cbn1cbnZhciBERUZBVUxUX0JVRkZFUl9DQVBBQ0lUWSA9IDMyICogMTAyNCAqIDI7XG52YXIgSVRFUl9CVUZTID0gW1xuICBuZXcgUmVzaXphYmxlQnVmZmVyKERFRkFVTFRfQlVGRkVSX0NBUEFDSVRZKVxuXTtcbnZhciBJVEVSX0JVRl9DT1VOVCA9IDE7XG5mdW5jdGlvbiB0YWtlQnVmKCkge1xuICByZXR1cm4gSVRFUl9CVUZfQ09VTlQgPyBJVEVSX0JVRlNbLS1JVEVSX0JVRl9DT1VOVF0gOiBuZXcgUmVzaXphYmxlQnVmZmVyKERFRkFVTFRfQlVGRkVSX0NBUEFDSVRZKTtcbn1cbmZ1bmN0aW9uIHJldHVybkJ1ZihidWYpIHtcbiAgSVRFUl9CVUZTW0lURVJfQlVGX0NPVU5UKytdID0gYnVmO1xufVxudmFyIExFQUZfQlVGID0gbmV3IFJlc2l6YWJsZUJ1ZmZlcihERUZBVUxUX0JVRkZFUl9DQVBBQ0lUWSk7XG52YXIgSXRlcmF0b3JIYW5kbGUgPSBjbGFzcyBfSXRlcmF0b3JIYW5kbGUge1xuICAjaWQ7XG4gIHN0YXRpYyAjZmluYWxpemF0aW9uUmVnaXN0cnkgPSBuZXcgRmluYWxpemF0aW9uUmVnaXN0cnkoXG4gICAgc3lzLnJvd19pdGVyX2JzYXRuX2Nsb3NlXG4gICk7XG4gIGNvbnN0cnVjdG9yKGlkKSB7XG4gICAgdGhpcy4jaWQgPSBpZDtcbiAgICBfSXRlcmF0b3JIYW5kbGUuI2ZpbmFsaXphdGlvblJlZ2lzdHJ5LnJlZ2lzdGVyKHRoaXMsIGlkLCB0aGlzKTtcbiAgfVxuICAvKiogVW5yZWdpc3RlciB0aGlzIG9iamVjdCB3aXRoIHRoZSBmaW5hbGl6YXRpb24gcmVnaXN0cnkgYW5kIHJldHVybiB0aGUgaWQgKi9cbiAgI2RldGFjaCgpIHtcbiAgICBjb25zdCBpZCA9IHRoaXMuI2lkO1xuICAgIHRoaXMuI2lkID0gLTE7XG4gICAgX0l0ZXJhdG9ySGFuZGxlLiNmaW5hbGl6YXRpb25SZWdpc3RyeS51bnJlZ2lzdGVyKHRoaXMpO1xuICAgIHJldHVybiBpZDtcbiAgfVxuICAvKiogQ2FsbCBgcm93X2l0ZXJfYnNhdG5fYWR2YW5jZWAsIHJldHVybmluZyAwIGlmIHRoaXMgaXRlcmF0b3IgaGFzIGJlZW4gZXhoYXVzdGVkLiAqL1xuICBhZHZhbmNlKGJ1Zikge1xuICAgIGlmICh0aGlzLiNpZCA9PT0gLTEpIHJldHVybiAwO1xuICAgIGNvbnN0IHJldCA9IGFkdmFuY2VJdGVyUmF3KHRoaXMuI2lkLCBidWYpO1xuICAgIGlmIChyZXQgPD0gMCkgdGhpcy4jZGV0YWNoKCk7XG4gICAgcmV0dXJuIHJldCA8IDAgPyAtcmV0IDogcmV0O1xuICB9XG4gIFtTeW1ib2wuZGlzcG9zZV0oKSB7XG4gICAgaWYgKHRoaXMuI2lkID49IDApIHtcbiAgICAgIGNvbnN0IGlkID0gdGhpcy4jZGV0YWNoKCk7XG4gICAgICBzeXMucm93X2l0ZXJfYnNhdG5fY2xvc2UoaWQpO1xuICAgIH1cbiAgfVxufTtcblxuLy8gc3JjL3NlcnZlci9odHRwX2ludGVybmFsLnRzXG52YXIgeyBmcmVlemU6IGZyZWV6ZTIgfSA9IE9iamVjdDtcbnZhciByZXF1ZXN0QmFzZVNpemUgPSBic2F0bkJhc2VTaXplKHsgdHlwZXM6IFtdIH0sIEh0dHBSZXF1ZXN0LmFsZ2VicmFpY1R5cGUpO1xuZnVuY3Rpb24gZmV0Y2godXJsLCBpbml0ID0ge30pIHtcbiAgY29uc3QgbWV0aG9kID0gc2VyaWFsaXplTWV0aG9kKGluaXQubWV0aG9kKTtcbiAgY29uc3QgaGVhZGVycyA9IHNlcmlhbGl6ZUhlYWRlcnMobmV3IEhlYWRlcnMoaW5pdC5oZWFkZXJzKSk7XG4gIGNvbnN0IHVyaSA9IFwiXCIgKyB1cmw7XG4gIGNvbnN0IHJlcXVlc3QgPSBmcmVlemUyKHtcbiAgICBtZXRob2QsXG4gICAgaGVhZGVycyxcbiAgICB0aW1lb3V0OiBpbml0LnRpbWVvdXQsXG4gICAgdXJpLFxuICAgIHZlcnNpb246IHsgdGFnOiBcIkh0dHAxMVwiIH1cbiAgfSk7XG4gIGNvbnN0IHJlcXVlc3RCdWYgPSBuZXcgQmluYXJ5V3JpdGVyKHJlcXVlc3RCYXNlU2l6ZSk7XG4gIEh0dHBSZXF1ZXN0LnNlcmlhbGl6ZShyZXF1ZXN0QnVmLCByZXF1ZXN0KTtcbiAgY29uc3QgYm9keSA9IGluaXQuYm9keSA9PSBudWxsID8gbmV3IFVpbnQ4QXJyYXkoKSA6IHR5cGVvZiBpbml0LmJvZHkgPT09IFwic3RyaW5nXCIgPyBpbml0LmJvZHkgOiBuZXcgVWludDhBcnJheShpbml0LmJvZHkpO1xuICBjb25zdCBbcmVzcG9uc2VCdWYsIHJlc3BvbnNlQm9keV0gPSBzeXMucHJvY2VkdXJlX2h0dHBfcmVxdWVzdChcbiAgICByZXF1ZXN0QnVmLmdldEJ1ZmZlcigpLFxuICAgIGJvZHlcbiAgKTtcbiAgY29uc3QgcmVzcG9uc2UgPSBIdHRwUmVzcG9uc2UuZGVzZXJpYWxpemUobmV3IEJpbmFyeVJlYWRlcihyZXNwb25zZUJ1ZikpO1xuICByZXR1cm4gU3luY1Jlc3BvbnNlW21ha2VSZXNwb25zZV0ocmVzcG9uc2VCb2R5LCB7XG4gICAgdHlwZTogXCJiYXNpY1wiLFxuICAgIHVybDogdXJpLFxuICAgIHN0YXR1czogcmVzcG9uc2UuY29kZSxcbiAgICBzdGF0dXNUZXh0OiAoMCwgaW1wb3J0X3N0YXR1c2VzLmRlZmF1bHQpKHJlc3BvbnNlLmNvZGUpLFxuICAgIGhlYWRlcnM6IGRlc2VyaWFsaXplSGVhZGVycyhyZXNwb25zZS5oZWFkZXJzKSxcbiAgICBhYm9ydGVkOiBmYWxzZSxcbiAgICB2ZXJzaW9uOiByZXNwb25zZS52ZXJzaW9uXG4gIH0pO1xufVxuZnJlZXplMihmZXRjaCk7XG52YXIgaHR0cENsaWVudCA9IGZyZWV6ZTIoeyBmZXRjaCB9KTtcblxuLy8gc3JjL3NlcnZlci9wcm9jZWR1cmVzLnRzXG5mdW5jdGlvbiBtYWtlUHJvY2VkdXJlRXhwb3J0KGN0eCwgb3B0cywgcGFyYW1zLCByZXQsIGZuKSB7XG4gIGNvbnN0IG5hbWUgPSBvcHRzPy5uYW1lO1xuICBjb25zdCBwcm9jZWR1cmVFeHBvcnQgPSAoLi4uYXJncykgPT4gZm4oLi4uYXJncyk7XG4gIHByb2NlZHVyZUV4cG9ydFtleHBvcnRDb250ZXh0XSA9IGN0eDtcbiAgcHJvY2VkdXJlRXhwb3J0W3JlZ2lzdGVyRXhwb3J0XSA9IChjdHgyLCBleHBvcnROYW1lKSA9PiB7XG4gICAgcmVnaXN0ZXJQcm9jZWR1cmUoY3R4MiwgbmFtZSA/PyBleHBvcnROYW1lLCBwYXJhbXMsIHJldCwgZm4pO1xuICAgIGN0eDIuZnVuY3Rpb25FeHBvcnRzLnNldChcbiAgICAgIHByb2NlZHVyZUV4cG9ydCxcbiAgICAgIG5hbWUgPz8gZXhwb3J0TmFtZVxuICAgICk7XG4gICAgaWYgKG9wdHM/Lm9uU2NoZWR1bGUgIT09IHZvaWQgMCkge1xuICAgICAgY3R4Mi5wZW5kaW5nU2NoZWR1bGVzLnB1c2goe1xuICAgICAgICB0YWJsZTogb3B0cy5vblNjaGVkdWxlLFxuICAgICAgICBmdW5jdGlvbk5hbWU6IG5hbWUgPz8gZXhwb3J0TmFtZVxuICAgICAgfSk7XG4gICAgfVxuICB9O1xuICByZXR1cm4gcHJvY2VkdXJlRXhwb3J0O1xufVxudmFyIFRyYW5zYWN0aW9uQ3R4SW1wbCA9IGNsYXNzIFRyYW5zYWN0aW9uQ3R4IGV4dGVuZHMgUmVkdWNlckN0eEltcGwge1xufTtcbmZ1bmN0aW9uIHJlZ2lzdGVyUHJvY2VkdXJlKGN0eCwgZXhwb3J0TmFtZSwgcGFyYW1zLCByZXQsIGZuLCBvcHRzKSB7XG4gIGN0eC5kZWZpbmVGdW5jdGlvbihleHBvcnROYW1lKTtcbiAgY29uc3QgcGFyYW1zVHlwZSA9IHtcbiAgICBlbGVtZW50czogT2JqZWN0LmVudHJpZXMocGFyYW1zKS5tYXAoKFtuLCBjXSkgPT4gKHtcbiAgICAgIG5hbWU6IG4sXG4gICAgICBhbGdlYnJhaWNUeXBlOiBjdHgucmVnaXN0ZXJUeXBlc1JlY3Vyc2l2ZWx5KFxuICAgICAgICBcInR5cGVCdWlsZGVyXCIgaW4gYyA/IGMudHlwZUJ1aWxkZXIgOiBjXG4gICAgICApLmFsZ2VicmFpY1R5cGVcbiAgICB9KSlcbiAgfTtcbiAgY29uc3QgcmV0dXJuVHlwZSA9IGN0eC5yZWdpc3RlclR5cGVzUmVjdXJzaXZlbHkocmV0KS5hbGdlYnJhaWNUeXBlO1xuICBjdHgubW9kdWxlRGVmLnByb2NlZHVyZXMucHVzaCh7XG4gICAgc291cmNlTmFtZTogZXhwb3J0TmFtZSxcbiAgICBwYXJhbXM6IHBhcmFtc1R5cGUsXG4gICAgcmV0dXJuVHlwZSxcbiAgICB2aXNpYmlsaXR5OiBGdW5jdGlvblZpc2liaWxpdHkuQ2xpZW50Q2FsbGFibGVcbiAgfSk7XG4gIGNvbnN0IHsgdHlwZXNwYWNlIH0gPSBjdHg7XG4gIGN0eC5wcm9jZWR1cmVzLnB1c2goe1xuICAgIGZuLFxuICAgIGRlc2VyaWFsaXplQXJnczogUHJvZHVjdFR5cGUubWFrZURlc2VyaWFsaXplcihwYXJhbXNUeXBlLCB0eXBlc3BhY2UpLFxuICAgIHNlcmlhbGl6ZVJldHVybjogQWxnZWJyYWljVHlwZS5tYWtlU2VyaWFsaXplcihyZXR1cm5UeXBlLCB0eXBlc3BhY2UpLFxuICAgIHJldHVyblR5cGVCYXNlU2l6ZTogYnNhdG5CYXNlU2l6ZSh0eXBlc3BhY2UsIHJldHVyblR5cGUpXG4gIH0pO1xufVxuZnVuY3Rpb24gY2FsbFByb2NlZHVyZShtb2R1bGVDdHgsIGlkLCBzZW5kZXIsIGNvbm5lY3Rpb25JZCwgdGltZXN0YW1wLCBhcmdzQnVmLCBkYlZpZXcpIHtcbiAgY29uc3QgeyBmbiwgZGVzZXJpYWxpemVBcmdzLCBzZXJpYWxpemVSZXR1cm4sIHJldHVyblR5cGVCYXNlU2l6ZSB9ID0gbW9kdWxlQ3R4LnByb2NlZHVyZXNbaWRdO1xuICBjb25zdCBhcmdzID0gZGVzZXJpYWxpemVBcmdzKG5ldyBCaW5hcnlSZWFkZXIoYXJnc0J1ZikpO1xuICBjb25zdCBjdHggPSBuZXcgUHJvY2VkdXJlQ3R4SW1wbChcbiAgICBzZW5kZXIsXG4gICAgdGltZXN0YW1wLFxuICAgIGNvbm5lY3Rpb25JZCxcbiAgICBkYlZpZXdcbiAgKTtcbiAgY29uc3QgcmV0ID0gY2FsbFVzZXJGdW5jdGlvbihmbiwgY3R4LCBhcmdzKTtcbiAgY29uc3QgcmV0QnVmID0gbmV3IEJpbmFyeVdyaXRlcihyZXR1cm5UeXBlQmFzZVNpemUpO1xuICBzZXJpYWxpemVSZXR1cm4ocmV0QnVmLCByZXQpO1xuICByZXR1cm4gcmV0QnVmLmdldEJ1ZmZlcigpO1xufVxudmFyIFByb2NlZHVyZUN0eEltcGwgPSBjbGFzcyBQcm9jZWR1cmVDdHgge1xuICBjb25zdHJ1Y3RvcihzZW5kZXIsIHRpbWVzdGFtcCwgY29ubmVjdGlvbklkLCBkYlZpZXcpIHtcbiAgICB0aGlzLnNlbmRlciA9IHNlbmRlcjtcbiAgICB0aGlzLnRpbWVzdGFtcCA9IHRpbWVzdGFtcDtcbiAgICB0aGlzLmNvbm5lY3Rpb25JZCA9IGNvbm5lY3Rpb25JZDtcbiAgICB0aGlzLiNkYlZpZXcgPSBkYlZpZXc7XG4gIH1cbiAgI2lkZW50aXR5O1xuICAjdXVpZENvdW50ZXI7XG4gICNyYW5kb207XG4gICNkYlZpZXc7XG4gIGdldCBkYXRhYmFzZUlkZW50aXR5KCkge1xuICAgIHJldHVybiB0aGlzLiNpZGVudGl0eSA/Pz0gbmV3IElkZW50aXR5KHN5cy5pZGVudGl0eSgpKTtcbiAgfVxuICBnZXQgaWRlbnRpdHkoKSB7XG4gICAgcmV0dXJuIHRoaXMuZGF0YWJhc2VJZGVudGl0eTtcbiAgfVxuICBnZXQgcmFuZG9tKCkge1xuICAgIHJldHVybiB0aGlzLiNyYW5kb20gPz89IG1ha2VSYW5kb20odGhpcy50aW1lc3RhbXApO1xuICB9XG4gIGdldCBodHRwKCkge1xuICAgIHJldHVybiBodHRwQ2xpZW50O1xuICB9XG4gIHdpdGhUeChib2R5KSB7XG4gICAgcmV0dXJuIHJ1bldpdGhUeChcbiAgICAgICh0aW1lc3RhbXApID0+IG5ldyBUcmFuc2FjdGlvbkN0eEltcGwoXG4gICAgICAgIHRoaXMuc2VuZGVyLFxuICAgICAgICB0aW1lc3RhbXAsXG4gICAgICAgIHRoaXMuY29ubmVjdGlvbklkLFxuICAgICAgICB0aGlzLiNkYlZpZXcoKVxuICAgICAgKSxcbiAgICAgIGJvZHlcbiAgICApO1xuICB9XG4gIG5ld1V1aWRWNCgpIHtcbiAgICBjb25zdCBieXRlcyA9IHRoaXMucmFuZG9tLmZpbGwobmV3IFVpbnQ4QXJyYXkoMTYpKTtcbiAgICByZXR1cm4gVXVpZC5mcm9tUmFuZG9tQnl0ZXNWNChieXRlcyk7XG4gIH1cbiAgbmV3VXVpZFY3KCkge1xuICAgIGNvbnN0IGJ5dGVzID0gdGhpcy5yYW5kb20uZmlsbChuZXcgVWludDhBcnJheSg0KSk7XG4gICAgY29uc3QgY291bnRlciA9IHRoaXMuI3V1aWRDb3VudGVyID8/PSB7IHZhbHVlOiAwIH07XG4gICAgcmV0dXJuIFV1aWQuZnJvbUNvdW50ZXJWNyhjb3VudGVyLCB0aGlzLnRpbWVzdGFtcCwgYnl0ZXMpO1xuICB9XG59O1xuXG4vLyBzcmMvc2VydmVyL3JlZHVjZXJzLnRzXG5mdW5jdGlvbiBtYWtlUmVkdWNlckV4cG9ydChjdHgsIG9wdHMsIHBhcmFtcywgZm4sIGxpZmVjeWNsZSkge1xuICBjb25zdCByZWR1Y2VyRXhwb3J0ID0gKC4uLmFyZ3MpID0+IGZuKC4uLmFyZ3MpO1xuICByZWR1Y2VyRXhwb3J0W2V4cG9ydENvbnRleHRdID0gY3R4O1xuICByZWR1Y2VyRXhwb3J0W3JlZ2lzdGVyRXhwb3J0XSA9IChjdHgyLCBleHBvcnROYW1lKSA9PiB7XG4gICAgcmVnaXN0ZXJSZWR1Y2VyKGN0eDIsIGV4cG9ydE5hbWUsIHBhcmFtcywgZm4sIG9wdHMsIGxpZmVjeWNsZSk7XG4gICAgY3R4Mi5mdW5jdGlvbkV4cG9ydHMuc2V0KFxuICAgICAgcmVkdWNlckV4cG9ydCxcbiAgICAgIGV4cG9ydE5hbWVcbiAgICApO1xuICAgIGlmIChvcHRzPy5vblNjaGVkdWxlICE9PSB2b2lkIDApIHtcbiAgICAgIGN0eDIucGVuZGluZ1NjaGVkdWxlcy5wdXNoKHtcbiAgICAgICAgdGFibGU6IG9wdHMub25TY2hlZHVsZSxcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBleHBvcnROYW1lXG4gICAgICB9KTtcbiAgICB9XG4gIH07XG4gIHJldHVybiByZWR1Y2VyRXhwb3J0O1xufVxuZnVuY3Rpb24gcmVnaXN0ZXJSZWR1Y2VyKGN0eCwgZXhwb3J0TmFtZSwgcGFyYW1zLCBmbiwgb3B0cywgbGlmZWN5Y2xlKSB7XG4gIGN0eC5kZWZpbmVGdW5jdGlvbihleHBvcnROYW1lKTtcbiAgaWYgKCEocGFyYW1zIGluc3RhbmNlb2YgUm93QnVpbGRlcikpIHtcbiAgICBwYXJhbXMgPSBuZXcgUm93QnVpbGRlcihwYXJhbXMpO1xuICB9XG4gIGlmIChwYXJhbXMudHlwZU5hbWUgPT09IHZvaWQgMCkge1xuICAgIHBhcmFtcy50eXBlTmFtZSA9IHRvUGFzY2FsQ2FzZShleHBvcnROYW1lKTtcbiAgfVxuICBjb25zdCByZWYgPSBjdHgucmVnaXN0ZXJUeXBlc1JlY3Vyc2l2ZWx5KHBhcmFtcyk7XG4gIGNvbnN0IHBhcmFtc1R5cGUgPSBjdHgucmVzb2x2ZVR5cGUocmVmKS52YWx1ZTtcbiAgY29uc3QgaXNMaWZlY3ljbGUgPSBsaWZlY3ljbGUgIT0gbnVsbDtcbiAgY3R4Lm1vZHVsZURlZi5yZWR1Y2Vycy5wdXNoKHtcbiAgICBzb3VyY2VOYW1lOiBleHBvcnROYW1lLFxuICAgIHBhcmFtczogcGFyYW1zVHlwZSxcbiAgICAvL01vZHVsZURlZiB2YWxpZGF0aW9uIGNvZGUgaXMgcmVzcG9uc2libGUgdG8gbWFyayBwcml2YXRlIHJlZHVjZXJzXG4gICAgdmlzaWJpbGl0eTogRnVuY3Rpb25WaXNpYmlsaXR5LkNsaWVudENhbGxhYmxlLFxuICAgIC8vSGFyZGNvZGVkIGZvciBub3cgLSByZWR1Y2VycyBkbyBub3QgcmV0dXJuIHZhbHVlcyB5ZXRcbiAgICBva1JldHVyblR5cGU6IEFsZ2VicmFpY1R5cGUuUHJvZHVjdCh7IGVsZW1lbnRzOiBbXSB9KSxcbiAgICBlcnJSZXR1cm5UeXBlOiBBbGdlYnJhaWNUeXBlLlN0cmluZ1xuICB9KTtcbiAgaWYgKG9wdHM/Lm5hbWUgIT0gbnVsbCkge1xuICAgIGN0eC5tb2R1bGVEZWYuZXhwbGljaXROYW1lcy5lbnRyaWVzLnB1c2goe1xuICAgICAgdGFnOiBcIkZ1bmN0aW9uXCIsXG4gICAgICB2YWx1ZToge1xuICAgICAgICBzb3VyY2VOYW1lOiBleHBvcnROYW1lLFxuICAgICAgICBjYW5vbmljYWxOYW1lOiBvcHRzLm5hbWVcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuICBpZiAoaXNMaWZlY3ljbGUpIHtcbiAgICBjdHgubW9kdWxlRGVmLmxpZmVDeWNsZVJlZHVjZXJzLnB1c2goe1xuICAgICAgbGlmZWN5Y2xlU3BlYzogbGlmZWN5Y2xlLFxuICAgICAgZnVuY3Rpb25OYW1lOiBleHBvcnROYW1lXG4gICAgfSk7XG4gIH1cbiAgaWYgKCFmbi5uYW1lKSB7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGZuLCBcIm5hbWVcIiwgeyB2YWx1ZTogZXhwb3J0TmFtZSwgd3JpdGFibGU6IGZhbHNlIH0pO1xuICB9XG4gIGN0eC5yZWR1Y2Vycy5wdXNoKGZuKTtcbn1cblxuLy8gc3JjL3NlcnZlci9zY2hlbWEudHNcbnZhciBTY2hlbWFJbm5lciA9IGNsYXNzIGV4dGVuZHMgTW9kdWxlQ29udGV4dCB7XG4gIHNjaGVtYVR5cGU7XG4gIGV4aXN0aW5nRnVuY3Rpb25zID0gLyogQF9fUFVSRV9fICovIG5ldyBTZXQoKTtcbiAgZXhpc3RpbmdIdHRwSGFuZGxlcnMgPSAvKiBAX19QVVJFX18gKi8gbmV3IFNldCgpO1xuICByZWR1Y2VycyA9IFtdO1xuICBwcm9jZWR1cmVzID0gW107XG4gIHZpZXdzID0gW107XG4gIGFub25WaWV3cyA9IFtdO1xuICBodHRwSGFuZGxlcnMgPSBbXTtcbiAgLyoqXG4gICAqIE1hcHMgcmVkdWNlci9wcm9jZWR1cmUgZXhwb3J0IG9iamVjdHMgdG8gdGhlaXIgc291cmNlIG5hbWVzLlxuICAgKiBVc2VkIGZvciByZXNvbHZpbmcgc2NoZWR1bGVkIHRhYmxlIHRhcmdldHMuXG4gICAqL1xuICBmdW5jdGlvbkV4cG9ydHMgPSAvKiBAX19QVVJFX18gKi8gbmV3IE1hcCgpO1xuICB0YWJsZVNvdXJjZU5hbWVzID0gLyogQF9fUFVSRV9fICovIG5ldyBNYXAoKTtcbiAgaHR0cEhhbmRsZXJFeHBvcnRzID0gLyogQF9fUFVSRV9fICovIG5ldyBNYXAoKTtcbiAgcGVuZGluZ1NjaGVkdWxlcyA9IFtdO1xuICBwZW5kaW5nSHR0cFJvdXRlcyA9IFtdO1xuICBjb25zdHJ1Y3RvcihnZXRTY2hlbWFUeXBlKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnNjaGVtYVR5cGUgPSBnZXRTY2hlbWFUeXBlKHRoaXMpO1xuICB9XG4gIGRlZmluZUZ1bmN0aW9uKG5hbWUpIHtcbiAgICBpZiAodGhpcy5leGlzdGluZ0Z1bmN0aW9ucy5oYXMobmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgIGBUaGVyZSBpcyBhbHJlYWR5IGEgcmVkdWNlciwgcHJvY2VkdXJlLCBvciB2aWV3IHdpdGggdGhlIG5hbWUgJyR7bmFtZX0nYFxuICAgICAgKTtcbiAgICB9XG4gICAgdGhpcy5leGlzdGluZ0Z1bmN0aW9ucy5hZGQobmFtZSk7XG4gIH1cbiAgZGVmaW5lSHR0cEhhbmRsZXIobmFtZSkge1xuICAgIGlmICh0aGlzLmV4aXN0aW5nSHR0cEhhbmRsZXJzLmhhcyhuYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgYFRoZXJlIGlzIGFscmVhZHkgYW4gSFRUUCBoYW5kbGVyIHdpdGggdGhlIG5hbWUgJyR7bmFtZX0nYFxuICAgICAgKTtcbiAgICB9XG4gICAgdGhpcy5leGlzdGluZ0h0dHBIYW5kbGVycy5hZGQobmFtZSk7XG4gIH1cbiAgcmVzb2x2ZVNjaGVkdWxlcygpIHtcbiAgICBjb25zdCBzY2hlZHVsZWRUYWJsZXMgPSAvKiBAX19QVVJFX18gKi8gbmV3IE1hcCgpO1xuICAgIGZvciAoY29uc3Qge1xuICAgICAgZnVuY3Rpb25OYW1lOiBrbm93bkZ1bmN0aW9uTmFtZSxcbiAgICAgIHJlZHVjZXIsXG4gICAgICB0YWJsZTogdGFibGUyLFxuICAgICAgdGFibGVOYW1lOiBrbm93blRhYmxlTmFtZSxcbiAgICAgIHNjaGVkdWxlQXRDb2w6IGtub3duU2NoZWR1bGVBdENvbFxuICAgIH0gb2YgdGhpcy5wZW5kaW5nU2NoZWR1bGVzKSB7XG4gICAgICBsZXQgdGFibGVOYW1lID0ga25vd25UYWJsZU5hbWU7XG4gICAgICBpZiAodGFibGVOYW1lID09PSB2b2lkIDApIHtcbiAgICAgICAgY29uc3QgdGFibGVOYW1lcyA9IHRoaXMudGFibGVTb3VyY2VOYW1lcy5nZXQodGFibGUyKTtcbiAgICAgICAgaWYgKHRhYmxlTmFtZXMgIT09IHZvaWQgMCAmJiB0YWJsZU5hbWVzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFxuICAgICAgICAgICAgXCJTY2hlZHVsZSB0YXJnZXQgdGFibGUgaXMgcmVnaXN0ZXJlZCBtb3JlIHRoYW4gb25jZSBpbiB0aGlzIHNjaGVtYS4gVXNlIGEgZGlzdGluY3QgdGFibGUgaGFuZGxlIGZvciBlYWNoIHNjaGVkdWxlZCB0YWJsZS5cIlxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgdGFibGVOYW1lID0gdGFibGVOYW1lcz8uWzBdO1xuICAgICAgfVxuICAgICAgaWYgKHRhYmxlTmFtZSA9PT0gdm9pZCAwKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgXCJTY2hlZHVsZSB0YXJnZXQgdGFibGUgaXMgbm90IHBhcnQgb2YgdGhpcyBzY2hlbWEuXCJcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHNjaGVkdWxlQXRDb2wgPSBrbm93blNjaGVkdWxlQXRDb2wgPz8gdGFibGUyLnNjaGVkdWxlQXRDb2w7XG4gICAgICBpZiAoc2NoZWR1bGVBdENvbCA9PT0gdm9pZCAwKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgYFRhYmxlICR7dGFibGVOYW1lfSBkZWZpbmVzIGEgc2NoZWR1bGUsIGJ1dCBpdCBkb2VzIG5vdCBoYXZlIGEgU2NoZWR1bGVBdCBjb2x1bW4uYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgY29uc3QgZnVuY3Rpb25OYW1lID0ga25vd25GdW5jdGlvbk5hbWUgPz8gKHJlZHVjZXIgPT09IHZvaWQgMCA/IHZvaWQgMCA6IHRoaXMuZnVuY3Rpb25FeHBvcnRzLmdldChyZWR1Y2VyKCkpKTtcbiAgICAgIGlmIChmdW5jdGlvbk5hbWUgPT09IHZvaWQgMCkge1xuICAgICAgICBjb25zdCBtc2cgPSBgVGFibGUgJHt0YWJsZU5hbWV9IGRlZmluZXMgYSBzY2hlZHVsZSwgYnV0IGl0IHNlZW1zIGxpa2UgdGhlIGFzc29jaWF0ZWQgZnVuY3Rpb24gd2FzIG5vdCBleHBvcnRlZC5gO1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKG1zZyk7XG4gICAgICB9XG4gICAgICBjb25zdCBleGlzdGluZ0Z1bmN0aW9uTmFtZSA9IHNjaGVkdWxlZFRhYmxlcy5nZXQodGFibGVOYW1lKTtcbiAgICAgIGlmIChleGlzdGluZ0Z1bmN0aW9uTmFtZSAhPT0gdm9pZCAwKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgYFRhYmxlICR7dGFibGVOYW1lfSBkZWZpbmVzIG11bHRpcGxlIHNjaGVkdWxlczogJHtleGlzdGluZ0Z1bmN0aW9uTmFtZX0gYW5kICR7ZnVuY3Rpb25OYW1lfS4gQSBzY2hlZHVsZSB0YWJsZSBjYW4gb25seSBiZSB1c2VkIGJ5IG9uZSByZWR1Y2VyIG9yIHByb2NlZHVyZS5gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBzY2hlZHVsZWRUYWJsZXMuc2V0KHRhYmxlTmFtZSwgZnVuY3Rpb25OYW1lKTtcbiAgICAgIHRoaXMubW9kdWxlRGVmLnNjaGVkdWxlcy5wdXNoKHtcbiAgICAgICAgc291cmNlTmFtZTogdm9pZCAwLFxuICAgICAgICB0YWJsZU5hbWUsXG4gICAgICAgIHNjaGVkdWxlQXRDb2wsXG4gICAgICAgIGZ1bmN0aW9uTmFtZVxuICAgICAgfSk7XG4gICAgfVxuICB9XG4gIHJlc29sdmVIdHRwUm91dGVzKCkge1xuICAgIGZvciAoY29uc3Qgcm91dGUgb2YgdGhpcy5wZW5kaW5nSHR0cFJvdXRlcykge1xuICAgICAgY29uc3QgaGFuZGxlckZ1bmN0aW9uID0gdGhpcy5odHRwSGFuZGxlckV4cG9ydHMuZ2V0KHJvdXRlLmhhbmRsZXIpO1xuICAgICAgaWYgKGhhbmRsZXJGdW5jdGlvbiA9PT0gdm9pZCAwKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgYEhUVFAgcm91dGUgZm9yIHBhdGggJyR7cm91dGUucGF0aH0nIHJlZmVycyB0byBhIGhhbmRsZXIgdGhhdCB3YXMgbm90IGV4cG9ydGVkLmBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHRoaXMubW9kdWxlRGVmLmh0dHBSb3V0ZXMucHVzaCh7XG4gICAgICAgIGhhbmRsZXJGdW5jdGlvbixcbiAgICAgICAgbWV0aG9kOiByb3V0ZS5tZXRob2QsXG4gICAgICAgIHBhdGg6IHJvdXRlLnBhdGhcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufTtcbnZhciBTY2hlbWEgPSBjbGFzcyB7XG4gICNjdHg7XG4gIGNvbnN0cnVjdG9yKGN0eCkge1xuICAgIHRoaXMuI2N0eCA9IGN0eDtcbiAgfVxuICBbbW9kdWxlSG9va3NdKGV4cG9ydHMpIHtcbiAgICBjb25zdCByZWdpc3RlcmVkU2NoZW1hID0gdGhpcy4jY3R4O1xuICAgIGZvciAoY29uc3QgW25hbWUsIG1vZHVsZUV4cG9ydF0gb2YgT2JqZWN0LmVudHJpZXMoZXhwb3J0cykpIHtcbiAgICAgIGlmIChuYW1lID09PSBcImRlZmF1bHRcIikgY29udGludWU7XG4gICAgICBpZiAoIWlzTW9kdWxlRXhwb3J0KG1vZHVsZUV4cG9ydCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgICBcImV4cG9ydGluZyBzb21ldGhpbmcgdGhhdCBpcyBub3QgYSBzcGFjZXRpbWUgZXhwb3J0XCJcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGNoZWNrRXhwb3J0Q29udGV4dChtb2R1bGVFeHBvcnQsIHJlZ2lzdGVyZWRTY2hlbWEpO1xuICAgICAgbW9kdWxlRXhwb3J0W3JlZ2lzdGVyRXhwb3J0XShyZWdpc3RlcmVkU2NoZW1hLCBuYW1lKTtcbiAgICB9XG4gICAgcmVnaXN0ZXJlZFNjaGVtYS5yZXNvbHZlU2NoZWR1bGVzKCk7XG4gICAgcmVnaXN0ZXJlZFNjaGVtYS5yZXNvbHZlSHR0cFJvdXRlcygpO1xuICAgIHJldHVybiBtYWtlSG9va3MocmVnaXN0ZXJlZFNjaGVtYSk7XG4gIH1cbiAgZ2V0IHNjaGVtYVR5cGUoKSB7XG4gICAgcmV0dXJuIHRoaXMuI2N0eC5zY2hlbWFUeXBlO1xuICB9XG4gIGdldCBtb2R1bGVEZWYoKSB7XG4gICAgcmV0dXJuIHRoaXMuI2N0eC5tb2R1bGVEZWY7XG4gIH1cbiAgZ2V0IHR5cGVzcGFjZSgpIHtcbiAgICByZXR1cm4gdGhpcy4jY3R4LnR5cGVzcGFjZTtcbiAgfVxuICByZWR1Y2VyKC4uLmFyZ3MpIHtcbiAgICBsZXQgb3B0cywgcGFyYW1zID0ge30sIGZuO1xuICAgIHN3aXRjaCAoYXJncy5sZW5ndGgpIHtcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgW2ZuXSA9IGFyZ3M7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOiB7XG4gICAgICAgIGxldCBhcmcxO1xuICAgICAgICBbYXJnMSwgZm5dID0gYXJncztcbiAgICAgICAgaWYgKHR5cGVvZiBhcmcxLm5hbWUgPT09IFwic3RyaW5nXCIpXG4gICAgICAgICAgb3B0cyA9IGFyZzE7XG4gICAgICAgIGVsc2UgcGFyYW1zID0gYXJnMTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjYXNlIDM6XG4gICAgICAgIFtvcHRzLCBwYXJhbXMsIGZuXSA9IGFyZ3M7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgICByZXR1cm4gbWFrZVJlZHVjZXJFeHBvcnQodGhpcy4jY3R4LCBvcHRzLCBwYXJhbXMsIGZuKTtcbiAgfVxuICBpbml0KC4uLmFyZ3MpIHtcbiAgICBsZXQgb3B0cywgZm47XG4gICAgc3dpdGNoIChhcmdzLmxlbmd0aCkge1xuICAgICAgY2FzZSAxOlxuICAgICAgICBbZm5dID0gYXJncztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDI6XG4gICAgICAgIFtvcHRzLCBmbl0gPSBhcmdzO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gICAgcmV0dXJuIG1ha2VSZWR1Y2VyRXhwb3J0KHRoaXMuI2N0eCwgb3B0cywge30sIGZuLCBMaWZlY3ljbGUuSW5pdCk7XG4gIH1cbiAgY2xpZW50Q29ubmVjdGVkKC4uLmFyZ3MpIHtcbiAgICBsZXQgb3B0cywgZm47XG4gICAgc3dpdGNoIChhcmdzLmxlbmd0aCkge1xuICAgICAgY2FzZSAxOlxuICAgICAgICBbZm5dID0gYXJncztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDI6XG4gICAgICAgIFtvcHRzLCBmbl0gPSBhcmdzO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gICAgcmV0dXJuIG1ha2VSZWR1Y2VyRXhwb3J0KHRoaXMuI2N0eCwgb3B0cywge30sIGZuLCBMaWZlY3ljbGUuT25Db25uZWN0KTtcbiAgfVxuICBjbGllbnREaXNjb25uZWN0ZWQoLi4uYXJncykge1xuICAgIGxldCBvcHRzLCBmbjtcbiAgICBzd2l0Y2ggKGFyZ3MubGVuZ3RoKSB7XG4gICAgICBjYXNlIDE6XG4gICAgICAgIFtmbl0gPSBhcmdzO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgW29wdHMsIGZuXSA9IGFyZ3M7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgICByZXR1cm4gbWFrZVJlZHVjZXJFeHBvcnQodGhpcy4jY3R4LCBvcHRzLCB7fSwgZm4sIExpZmVjeWNsZS5PbkRpc2Nvbm5lY3QpO1xuICB9XG4gIHZpZXcob3B0cywgcmV0LCBmbiwgLi4uXykge1xuICAgIHJldHVybiBtYWtlVmlld0V4cG9ydCh0aGlzLiNjdHgsIG9wdHMsIHt9LCByZXQsIGZuKTtcbiAgfVxuICAvLyBUT0RPOiByZS1lbmFibGUgb25jZSBwYXJhbWV0ZXJpemVkIHZpZXdzIGFyZSBzdXBwb3J0ZWQgaW4gU1FMXG4gIC8vIHZpZXc8UmV0IGV4dGVuZHMgVmlld1JldHVyblR5cGVCdWlsZGVyPihcbiAgLy8gICBvcHRzOiBWaWV3T3B0cyxcbiAgLy8gICByZXQ6IFJldCxcbiAgLy8gICBmbjogVmlld0ZuPFMsIHt9LCBSZXQ+XG4gIC8vICk6IHZvaWQ7XG4gIC8vIHZpZXc8UGFyYW1zIGV4dGVuZHMgUGFyYW1zT2JqLCBSZXQgZXh0ZW5kcyBWaWV3UmV0dXJuVHlwZUJ1aWxkZXI+KFxuICAvLyAgIG9wdHM6IFZpZXdPcHRzLFxuICAvLyAgIHBhcmFtczogUGFyYW1zLFxuICAvLyAgIHJldDogUmV0LFxuICAvLyAgIGZuOiBWaWV3Rm48Uywge30sIFJldD5cbiAgLy8gKTogdm9pZDtcbiAgLy8gdmlldzxQYXJhbXMgZXh0ZW5kcyBQYXJhbXNPYmosIFJldCBleHRlbmRzIFZpZXdSZXR1cm5UeXBlQnVpbGRlcj4oXG4gIC8vICAgb3B0czogVmlld09wdHMsXG4gIC8vICAgcGFyYW1zT3JSZXQ6IFJldCB8IFBhcmFtcyxcbiAgLy8gICByZXRPckZuOiBWaWV3Rm48Uywge30sIFJldD4gfCBSZXQsXG4gIC8vICAgbWF5YmVGbj86IFZpZXdGbjxTLCBQYXJhbXMsIFJldD5cbiAgLy8gKTogdm9pZCB7XG4gIC8vICAgaWYgKHR5cGVvZiByZXRPckZuID09PSAnZnVuY3Rpb24nKSB7XG4gIC8vICAgICBkZWZpbmVWaWV3KG5hbWUsIGZhbHNlLCB7fSwgcGFyYW1zT3JSZXQgYXMgUmV0LCByZXRPckZuKTtcbiAgLy8gICB9IGVsc2Uge1xuICAvLyAgICAgZGVmaW5lVmlldyhuYW1lLCBmYWxzZSwgcGFyYW1zT3JSZXQgYXMgUGFyYW1zLCByZXRPckZuLCBtYXliZUZuISk7XG4gIC8vICAgfVxuICAvLyB9XG4gIGFub255bW91c1ZpZXcob3B0cywgcmV0LCBmbiwgLi4uXykge1xuICAgIHJldHVybiBtYWtlQW5vblZpZXdFeHBvcnQodGhpcy4jY3R4LCBvcHRzLCB7fSwgcmV0LCBmbik7XG4gIH1cbiAgcHJvY2VkdXJlKC4uLmFyZ3MpIHtcbiAgICBsZXQgb3B0cywgcGFyYW1zID0ge30sIHJldCwgZm47XG4gICAgc3dpdGNoIChhcmdzLmxlbmd0aCkge1xuICAgICAgY2FzZSAyOlxuICAgICAgICBbcmV0LCBmbl0gPSBhcmdzO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMzoge1xuICAgICAgICBsZXQgYXJnMTtcbiAgICAgICAgW2FyZzEsIHJldCwgZm5dID0gYXJncztcbiAgICAgICAgaWYgKHR5cGVvZiBhcmcxLm5hbWUgPT09IFwic3RyaW5nXCIpXG4gICAgICAgICAgb3B0cyA9IGFyZzE7XG4gICAgICAgIGVsc2UgcGFyYW1zID0gYXJnMTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjYXNlIDQ6XG4gICAgICAgIFtvcHRzLCBwYXJhbXMsIHJldCwgZm5dID0gYXJncztcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICAgIHJldHVybiBtYWtlUHJvY2VkdXJlRXhwb3J0KHRoaXMuI2N0eCwgb3B0cywgcGFyYW1zLCByZXQsIGZuKTtcbiAgfVxuICBodHRwSGFuZGxlciguLi5hcmdzKSB7XG4gICAgbGV0IG9wdHMsIGZuO1xuICAgIHN3aXRjaCAoYXJncy5sZW5ndGgpIHtcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgW2ZuXSA9IGFyZ3M7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOlxuICAgICAgICBbb3B0cywgZm5dID0gYXJncztcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICAgIHJldHVybiBtYWtlSHR0cEhhbmRsZXJFeHBvcnQodGhpcy4jY3R4LCBvcHRzLCBmbik7XG4gIH1cbiAgaHR0cFJvdXRlcihyb3V0ZXIpIHtcbiAgICByZXR1cm4gbWFrZUh0dHBSb3V0ZXJFeHBvcnQodGhpcy4jY3R4LCByb3V0ZXIpO1xuICB9XG4gIC8qKlxuICAgKiBCdW5kbGUgbXVsdGlwbGUgcmVkdWNlcnMsIHByb2NlZHVyZXMsIGV0YyBpbnRvIG9uZSB2YWx1ZSB0byBleHBvcnQuXG4gICAqIFRoZSBuYW1lIHRoZXkgd2lsbCBiZSBleHBvcnRlZCB3aXRoIGlzIHRoZWlyIGNvcnJlc3BvbmRpbmcga2V5IGluIHRoZSBgZXhwb3J0c2AgYXJndW1lbnQuXG4gICAqL1xuICBleHBvcnRHcm91cChleHBvcnRzKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIFtleHBvcnRDb250ZXh0XTogdGhpcy4jY3R4LFxuICAgICAgW3JlZ2lzdGVyRXhwb3J0XShjdHgsIF9leHBvcnROYW1lKSB7XG4gICAgICAgIGZvciAoY29uc3QgW2V4cG9ydE5hbWUsIG1vZHVsZUV4cG9ydF0gb2YgT2JqZWN0LmVudHJpZXMoZXhwb3J0cykpIHtcbiAgICAgICAgICBjaGVja0V4cG9ydENvbnRleHQobW9kdWxlRXhwb3J0LCBjdHgpO1xuICAgICAgICAgIG1vZHVsZUV4cG9ydFtyZWdpc3RlckV4cG9ydF0oY3R4LCBleHBvcnROYW1lKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG4gIH1cbiAgY2xpZW50VmlzaWJpbGl0eUZpbHRlciA9IHtcbiAgICBzcWw6IChmaWx0ZXIpID0+ICh7XG4gICAgICBbZXhwb3J0Q29udGV4dF06IHRoaXMuI2N0eCxcbiAgICAgIFtyZWdpc3RlckV4cG9ydF0oY3R4LCBfZXhwb3J0TmFtZSkge1xuICAgICAgICBjdHgubW9kdWxlRGVmLnJvd0xldmVsU2VjdXJpdHkucHVzaCh7IHNxbDogZmlsdGVyIH0pO1xuICAgICAgfVxuICAgIH0pXG4gIH07XG59O1xudmFyIHJlZ2lzdGVyRXhwb3J0ID0gU3ltYm9sKFwiU3BhY2V0aW1lREIucmVnaXN0ZXJFeHBvcnRcIik7XG52YXIgZXhwb3J0Q29udGV4dCA9IFN5bWJvbChcIlNwYWNldGltZURCLmV4cG9ydENvbnRleHRcIik7XG5mdW5jdGlvbiBpc01vZHVsZUV4cG9ydCh4KSB7XG4gIHJldHVybiAodHlwZW9mIHggPT09IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgeCA9PT0gXCJvYmplY3RcIikgJiYgeCAhPT0gbnVsbCAmJiByZWdpc3RlckV4cG9ydCBpbiB4O1xufVxuZnVuY3Rpb24gY2hlY2tFeHBvcnRDb250ZXh0KGV4cCwgc2NoZW1hMikge1xuICBpZiAoZXhwW2V4cG9ydENvbnRleHRdICE9IG51bGwgJiYgZXhwW2V4cG9ydENvbnRleHRdICE9PSBzY2hlbWEyKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIm11bHRpcGxlIHNjaGVtYXMgYXJlIG5vdCBzdXBwb3J0ZWRcIik7XG4gIH1cbn1cbmZ1bmN0aW9uIHNjaGVtYSh0YWJsZXMsIG1vZHVsZVNldHRpbmdzKSB7XG4gIGNvbnN0IGN0eCA9IG5ldyBTY2hlbWFJbm5lcigoY3R4MikgPT4ge1xuICAgIGlmIChtb2R1bGVTZXR0aW5ncz8uQ0FTRV9DT05WRVJTSU9OX1BPTElDWSAhPSBudWxsKSB7XG4gICAgICBjdHgyLnNldENhc2VDb252ZXJzaW9uUG9saWN5KG1vZHVsZVNldHRpbmdzLkNBU0VfQ09OVkVSU0lPTl9QT0xJQ1kpO1xuICAgIH1cbiAgICBjb25zdCB0YWJsZVNjaGVtYXMgPSB7fTtcbiAgICBmb3IgKGNvbnN0IFthY2NOYW1lLCB0YWJsZTJdIG9mIE9iamVjdC5lbnRyaWVzKHRhYmxlcykpIHtcbiAgICAgIGNvbnN0IHRhYmxlRGVmID0gdGFibGUyLnRhYmxlRGVmKGN0eDIsIGFjY05hbWUpO1xuICAgICAgdGFibGVTY2hlbWFzW2FjY05hbWVdID0gdGFibGVUb1NjaGVtYShhY2NOYW1lLCB0YWJsZTIsIHRhYmxlRGVmKTtcbiAgICAgIGNvbnN0IHRhYmxlU291cmNlTmFtZXMgPSBjdHgyLnRhYmxlU291cmNlTmFtZXMuZ2V0KHRhYmxlMik7XG4gICAgICBpZiAodGFibGVTb3VyY2VOYW1lcyA9PT0gdm9pZCAwKSB7XG4gICAgICAgIGN0eDIudGFibGVTb3VyY2VOYW1lcy5zZXQodGFibGUyLCBbdGFibGVEZWYuc291cmNlTmFtZV0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGFibGVTb3VyY2VOYW1lcy5wdXNoKHRhYmxlRGVmLnNvdXJjZU5hbWUpO1xuICAgICAgfVxuICAgICAgY3R4Mi5tb2R1bGVEZWYudGFibGVzLnB1c2godGFibGVEZWYpO1xuICAgICAgaWYgKHRhYmxlMi5zY2hlZHVsZSkge1xuICAgICAgICBjdHgyLnBlbmRpbmdTY2hlZHVsZXMucHVzaCh7XG4gICAgICAgICAgdGFibGU6IHRhYmxlMixcbiAgICAgICAgICB0YWJsZU5hbWU6IHRhYmxlRGVmLnNvdXJjZU5hbWUsXG4gICAgICAgICAgc2NoZWR1bGVBdENvbDogdGFibGUyLnNjaGVkdWxlLnNjaGVkdWxlQXRDb2wsXG4gICAgICAgICAgcmVkdWNlcjogdGFibGUyLnNjaGVkdWxlLnJlZHVjZXJcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBpZiAodGFibGUyLnRhYmxlTmFtZSkge1xuICAgICAgICBjdHgyLm1vZHVsZURlZi5leHBsaWNpdE5hbWVzLmVudHJpZXMucHVzaCh7XG4gICAgICAgICAgdGFnOiBcIlRhYmxlXCIsXG4gICAgICAgICAgdmFsdWU6IHtcbiAgICAgICAgICAgIHNvdXJjZU5hbWU6IGFjY05hbWUsXG4gICAgICAgICAgICBjYW5vbmljYWxOYW1lOiB0YWJsZTIudGFibGVOYW1lXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHsgdGFibGVzOiB0YWJsZVNjaGVtYXMgfTtcbiAgfSk7XG4gIHJldHVybiBuZXcgU2NoZW1hKGN0eCk7XG59XG5cbi8vIHNyYy9zZXJ2ZXIvY29uc29sZS50c1xudmFyIGltcG9ydF9vYmplY3RfaW5zcGVjdCA9IF9fdG9FU00ocmVxdWlyZV9vYmplY3RfaW5zcGVjdCgpKTtcbnZhciBmbXRMb2cgPSAoLi4uZGF0YSkgPT4gZGF0YS5tYXAoKHgpID0+IHR5cGVvZiB4ID09PSBcInN0cmluZ1wiID8geCA6ICgwLCBpbXBvcnRfb2JqZWN0X2luc3BlY3QuZGVmYXVsdCkoeCkpLmpvaW4oXCIgXCIpO1xudmFyIGNvbnNvbGVfbGV2ZWxfZXJyb3IgPSAwO1xudmFyIGNvbnNvbGVfbGV2ZWxfd2FybiA9IDE7XG52YXIgY29uc29sZV9sZXZlbF9pbmZvID0gMjtcbnZhciBjb25zb2xlX2xldmVsX2RlYnVnID0gMztcbnZhciBjb25zb2xlX2xldmVsX3RyYWNlID0gNDtcbnZhciB0aW1lck1hcCA9IC8qIEBfX1BVUkVfXyAqLyBuZXcgTWFwKCk7XG52YXIgY29uc29sZTIgPSB7XG4gIC8vIEB0cy1leHBlY3QtZXJyb3Igd2Ugd2FudCBhIGJsYW5rIHByb3RvdHlwZSwgYnV0IHR5cGVzY3JpcHQgY29tcGxhaW5zXG4gIF9fcHJvdG9fXzoge30sXG4gIFtTeW1ib2wudG9TdHJpbmdUYWddOiBcImNvbnNvbGVcIixcbiAgYXNzZXJ0OiAoY29uZGl0aW9uID0gZmFsc2UsIC4uLmRhdGEpID0+IHtcbiAgICBpZiAoIWNvbmRpdGlvbikge1xuICAgICAgc3lzLmNvbnNvbGVfbG9nKGNvbnNvbGVfbGV2ZWxfZXJyb3IsIGZtdExvZyguLi5kYXRhKSk7XG4gICAgfVxuICB9LFxuICBjbGVhcjogKCkgPT4ge1xuICB9LFxuICBkZWJ1ZzogKC4uLmRhdGEpID0+IHtcbiAgICBzeXMuY29uc29sZV9sb2coY29uc29sZV9sZXZlbF9kZWJ1ZywgZm10TG9nKC4uLmRhdGEpKTtcbiAgfSxcbiAgZXJyb3I6ICguLi5kYXRhKSA9PiB7XG4gICAgc3lzLmNvbnNvbGVfbG9nKGNvbnNvbGVfbGV2ZWxfZXJyb3IsIGZtdExvZyguLi5kYXRhKSk7XG4gIH0sXG4gIGluZm86ICguLi5kYXRhKSA9PiB7XG4gICAgc3lzLmNvbnNvbGVfbG9nKGNvbnNvbGVfbGV2ZWxfaW5mbywgZm10TG9nKC4uLmRhdGEpKTtcbiAgfSxcbiAgbG9nOiAoLi4uZGF0YSkgPT4ge1xuICAgIHN5cy5jb25zb2xlX2xvZyhjb25zb2xlX2xldmVsX2luZm8sIGZtdExvZyguLi5kYXRhKSk7XG4gIH0sXG4gIHRhYmxlOiAodGFidWxhckRhdGEsIF9wcm9wZXJ0aWVzKSA9PiB7XG4gICAgc3lzLmNvbnNvbGVfbG9nKGNvbnNvbGVfbGV2ZWxfaW5mbywgZm10TG9nKHRhYnVsYXJEYXRhKSk7XG4gIH0sXG4gIHRyYWNlOiAoLi4uZGF0YSkgPT4ge1xuICAgIHN5cy5jb25zb2xlX2xvZyhjb25zb2xlX2xldmVsX3RyYWNlLCBmbXRMb2coLi4uZGF0YSkpO1xuICB9LFxuICB3YXJuOiAoLi4uZGF0YSkgPT4ge1xuICAgIHN5cy5jb25zb2xlX2xvZyhjb25zb2xlX2xldmVsX3dhcm4sIGZtdExvZyguLi5kYXRhKSk7XG4gIH0sXG4gIGRpcjogKF9pdGVtLCBfb3B0aW9ucykgPT4ge1xuICB9LFxuICBkaXJ4bWw6ICguLi5fZGF0YSkgPT4ge1xuICB9LFxuICAvLyBDb3VudGluZ1xuICBjb3VudDogKF9sYWJlbCA9IFwiZGVmYXVsdFwiKSA9PiB7XG4gIH0sXG4gIGNvdW50UmVzZXQ6IChfbGFiZWwgPSBcImRlZmF1bHRcIikgPT4ge1xuICB9LFxuICAvLyBHcm91cGluZ1xuICBncm91cDogKC4uLl9kYXRhKSA9PiB7XG4gIH0sXG4gIGdyb3VwQ29sbGFwc2VkOiAoLi4uX2RhdGEpID0+IHtcbiAgfSxcbiAgZ3JvdXBFbmQ6ICgpID0+IHtcbiAgfSxcbiAgLy8gVGltaW5nXG4gIHRpbWU6IChsYWJlbCA9IFwiZGVmYXVsdFwiKSA9PiB7XG4gICAgaWYgKHRpbWVyTWFwLmhhcyhsYWJlbCkpIHtcbiAgICAgIHN5cy5jb25zb2xlX2xvZyhjb25zb2xlX2xldmVsX3dhcm4sIGBUaW1lciAnJHtsYWJlbH0nIGFscmVhZHkgZXhpc3RzLmApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aW1lck1hcC5zZXQobGFiZWwsIHN5cy5jb25zb2xlX3RpbWVyX3N0YXJ0KGxhYmVsKSk7XG4gIH0sXG4gIHRpbWVMb2c6IChsYWJlbCA9IFwiZGVmYXVsdFwiLCAuLi5kYXRhKSA9PiB7XG4gICAgc3lzLmNvbnNvbGVfbG9nKGNvbnNvbGVfbGV2ZWxfaW5mbywgZm10TG9nKGxhYmVsLCAuLi5kYXRhKSk7XG4gIH0sXG4gIHRpbWVFbmQ6IChsYWJlbCA9IFwiZGVmYXVsdFwiKSA9PiB7XG4gICAgY29uc3Qgc3BhbklkID0gdGltZXJNYXAuZ2V0KGxhYmVsKTtcbiAgICBpZiAoc3BhbklkID09PSB2b2lkIDApIHtcbiAgICAgIHN5cy5jb25zb2xlX2xvZyhjb25zb2xlX2xldmVsX3dhcm4sIGBUaW1lciAnJHtsYWJlbH0nIGRvZXMgbm90IGV4aXN0LmApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBzeXMuY29uc29sZV90aW1lcl9lbmQoc3BhbklkKTtcbiAgICB0aW1lck1hcC5kZWxldGUobGFiZWwpO1xuICB9LFxuICAvLyBBZGRpdGlvbmFsIGNvbnNvbGUgbWV0aG9kcyB0byBzYXRpc2Z5IHRoZSBDb25zb2xlIGludGVyZmFjZVxuICB0aW1lU3RhbXA6ICgpID0+IHtcbiAgfSxcbiAgcHJvZmlsZTogKCkgPT4ge1xuICB9LFxuICBwcm9maWxlRW5kOiAoKSA9PiB7XG4gIH1cbn07XG5cbi8vIHNyYy9zZXJ2ZXIvcG9seWZpbGxzLnRzXG5nbG9iYWxUaGlzLmNvbnNvbGUgPSBjb25zb2xlMjtcbi8qISBCdW5kbGVkIGxpY2Vuc2UgaW5mb3JtYXRpb246XG5cbnN0YXR1c2VzL2luZGV4LmpzOlxuICAoKiFcbiAgICogc3RhdHVzZXNcbiAgICogQ29weXJpZ2h0KGMpIDIwMTQgSm9uYXRoYW4gT25nXG4gICAqIENvcHlyaWdodChjKSAyMDE2IERvdWdsYXMgQ2hyaXN0b3BoZXIgV2lsc29uXG4gICAqIE1JVCBMaWNlbnNlZFxuICAgKilcbiovXG5cbmV4cG9ydCB7IEFycmF5QnVpbGRlciwgQXJyYXlDb2x1bW5CdWlsZGVyLCBCb29sQnVpbGRlciwgQm9vbENvbHVtbkJ1aWxkZXIsIEJvb2xlYW5FeHByLCBCeXRlQXJyYXlCdWlsZGVyLCBCeXRlQXJyYXlDb2x1bW5CdWlsZGVyLCBDYXNlQ29udmVyc2lvblBvbGljeSwgQ29sdW1uQnVpbGRlciwgQ29sdW1uRXhwcmVzc2lvbiwgQ29ubmVjdGlvbklkQnVpbGRlciwgQ29ubmVjdGlvbklkQ29sdW1uQnVpbGRlciwgRjMyQnVpbGRlciwgRjMyQ29sdW1uQnVpbGRlciwgRjY0QnVpbGRlciwgRjY0Q29sdW1uQnVpbGRlciwgSTEyOEJ1aWxkZXIsIEkxMjhDb2x1bW5CdWlsZGVyLCBJMTZCdWlsZGVyLCBJMTZDb2x1bW5CdWlsZGVyLCBJMjU2QnVpbGRlciwgSTI1NkNvbHVtbkJ1aWxkZXIsIEkzMkJ1aWxkZXIsIEkzMkNvbHVtbkJ1aWxkZXIsIEk2NEJ1aWxkZXIsIEk2NENvbHVtbkJ1aWxkZXIsIEk4QnVpbGRlciwgSThDb2x1bW5CdWlsZGVyLCBJZGVudGl0eUJ1aWxkZXIsIElkZW50aXR5Q29sdW1uQnVpbGRlciwgT3B0aW9uQnVpbGRlciwgT3B0aW9uQ29sdW1uQnVpbGRlciwgUHJvZHVjdEJ1aWxkZXIsIFByb2R1Y3RDb2x1bW5CdWlsZGVyLCBSYW5nZSwgUmVmQnVpbGRlciwgUmVxdWVzdCwgUmVzdWx0QnVpbGRlciwgUmVzdWx0Q29sdW1uQnVpbGRlciwgUm91dGVyLCBSb3dCdWlsZGVyLCBTY2hlZHVsZUF0QnVpbGRlciwgU2NoZWR1bGVBdENvbHVtbkJ1aWxkZXIsIFNlbmRlckVycm9yLCBTaW1wbGVTdW1CdWlsZGVyLCBTaW1wbGVTdW1Db2x1bW5CdWlsZGVyLCBTcGFjZXRpbWVIb3N0RXJyb3IsIFN0cmluZ0J1aWxkZXIsIFN0cmluZ0NvbHVtbkJ1aWxkZXIsIFN1bUJ1aWxkZXIsIFN1bUNvbHVtbkJ1aWxkZXIsIFN5bmNSZXNwb25zZSwgVGltZUR1cmF0aW9uQnVpbGRlciwgVGltZUR1cmF0aW9uQ29sdW1uQnVpbGRlciwgVGltZXN0YW1wQnVpbGRlciwgVGltZXN0YW1wQ29sdW1uQnVpbGRlciwgVHlwZUJ1aWxkZXIsIFUxMjhCdWlsZGVyLCBVMTI4Q29sdW1uQnVpbGRlciwgVTE2QnVpbGRlciwgVTE2Q29sdW1uQnVpbGRlciwgVTI1NkJ1aWxkZXIsIFUyNTZDb2x1bW5CdWlsZGVyLCBVMzJCdWlsZGVyLCBVMzJDb2x1bW5CdWlsZGVyLCBVNjRCdWlsZGVyLCBVNjRDb2x1bW5CdWlsZGVyLCBVOEJ1aWxkZXIsIFU4Q29sdW1uQnVpbGRlciwgVXVpZEJ1aWxkZXIsIFV1aWRDb2x1bW5CdWlsZGVyLCBhbmQsIGNyZWF0ZVRhYmxlUmVmRnJvbURlZiwgZXJyb3JzLCBldmFsdWF0ZUJvb2xlYW5FeHByLCBnZXRRdWVyeUFjY2Vzc29yTmFtZSwgZ2V0UXVlcnlUYWJsZU5hbWUsIGdldFF1ZXJ5V2hlcmVDbGF1c2UsIGlzUm93VHlwZWRRdWVyeSwgaXNUeXBlZFF1ZXJ5LCBsaXRlcmFsLCBtYWtlUXVlcnlCdWlsZGVyLCBub3QsIG9yLCBzY2hlbWEsIHQsIHRhYmxlLCB0b0NhbWVsQ2FzZSwgdG9Db21wYXJhYmxlVmFsdWUsIHRvU3FsIH07XG4vLyMgc291cmNlTWFwcGluZ1VSTD1pbmRleC5tanMubWFwXG4vLyMgc291cmNlTWFwcGluZ1VSTD1pbmRleC5tanMubWFwIiwiaW1wb3J0IHsgc2NoZW1hLCB0YWJsZSwgdCB9IGZyb20gJ3NwYWNldGltZWRiL3NlcnZlcic7XG5pbXBvcnQgdHlwZSB7IElkZW50aXR5IH0gZnJvbSAnc3BhY2V0aW1lZGInO1xuXG4vLyBAcmVmIExMUCAwMTAyI2FwcC0zLWxpbmVhci1zaGFwZWQtaXNzdWUtdHJhY2tlciDigJQgcHJpdmF0ZSBzb3VyY2UgdGFibGVzLFxuLy8gY2FsbGVyLWRlcGVuZGVudCB2aWV3cywgcmVkdWNlci1vbmx5IHdyaXRlcywgYW5kIGRldGVybWluaXN0aWMgbWF0ZXJpYWxpemVkXG4vLyBwYWdlcyBwcmVzZXJ2ZSB0aGUgZnJvemVuIGF1dGhvcml0eSBhbmQgcGFnaW5hdGlvbiBmYWN0cyB3aXRob3V0IGEgc2hhcmVkXG4vLyBiYWNrZW5kIGFic3RyYWN0aW9uLlxuY29uc3QgcGVyc29uYSA9IHRhYmxlKFxuICB7IG5hbWU6ICdwZXJzb25hJyB9LFxuICB7XG4gICAgaWRlbnRpdHk6IHQuaWRlbnRpdHkoKS5wcmltYXJ5S2V5KCksXG4gICAgbmFtZTogdC5zdHJpbmcoKS51bmlxdWUoKSxcbiAgfSxcbik7XG5cbmNvbnN0IG9yZ2FuaXphdGlvbiA9IHRhYmxlKFxuICB7IG5hbWU6ICdvcmdhbml6YXRpb24nIH0sXG4gIHtcbiAgICBpZDogdC5zdHJpbmcoKS5wcmltYXJ5S2V5KCksXG4gICAgbmFtZTogdC5zdHJpbmcoKSxcbiAgfSxcbik7XG5cbmNvbnN0IG9yZ2FuaXphdGlvbk1lbWJlcnNoaXAgPSB0YWJsZShcbiAgeyBuYW1lOiAnb3JnYW5pemF0aW9uX21lbWJlcnNoaXAnIH0sXG4gIHtcbiAgICBpZDogdC5zdHJpbmcoKS5wcmltYXJ5S2V5KCksXG4gICAgb3JnYW5pemF0aW9uSWQ6IHQuc3RyaW5nKCkuaW5kZXgoJ2J0cmVlJyksXG4gICAgaWRlbnRpdHk6IHQuaWRlbnRpdHkoKS5pbmRleCgnYnRyZWUnKSxcbiAgICByb2xlOiB0LnN0cmluZygpLFxuICAgIGFjdGl2ZTogdC5ib29sKCksXG4gIH0sXG4pO1xuXG5jb25zdCB0ZWFtID0gdGFibGUoXG4gIHsgbmFtZTogJ3RlYW0nIH0sXG4gIHtcbiAgICBpZDogdC5zdHJpbmcoKS5wcmltYXJ5S2V5KCksXG4gICAgb3JnYW5pemF0aW9uSWQ6IHQuc3RyaW5nKCkuaW5kZXgoJ2J0cmVlJyksXG4gICAgbmFtZTogdC5zdHJpbmcoKSxcbiAgfSxcbik7XG5cbmNvbnN0IHRlYW1NZW1iZXJzaGlwID0gdGFibGUoXG4gIHsgbmFtZTogJ3RlYW1fbWVtYmVyc2hpcCcgfSxcbiAge1xuICAgIGlkOiB0LnN0cmluZygpLnByaW1hcnlLZXkoKSxcbiAgICB0ZWFtSWQ6IHQuc3RyaW5nKCkuaW5kZXgoJ2J0cmVlJyksXG4gICAgaWRlbnRpdHk6IHQuaWRlbnRpdHkoKS5pbmRleCgnYnRyZWUnKSxcbiAgICByb2xlOiB0LnN0cmluZygpLFxuICAgIGFjdGl2ZTogdC5ib29sKCksXG4gIH0sXG4pO1xuXG5jb25zdCBwcm9qZWN0ID0gdGFibGUoXG4gIHsgbmFtZTogJ3Byb2plY3QnIH0sXG4gIHtcbiAgICBpZDogdC5zdHJpbmcoKS5wcmltYXJ5S2V5KCksXG4gICAgb3JnYW5pemF0aW9uSWQ6IHQuc3RyaW5nKCkuaW5kZXgoJ2J0cmVlJyksXG4gICAgdGVhbUlkOiB0LnN0cmluZygpLmluZGV4KCdidHJlZScpLFxuICAgIG5hbWU6IHQuc3RyaW5nKCksXG4gIH0sXG4pO1xuXG5jb25zdCBsYWJlbCA9IHRhYmxlKFxuICB7IG5hbWU6ICdsYWJlbCcgfSxcbiAge1xuICAgIGlkOiB0LnN0cmluZygpLnByaW1hcnlLZXkoKSxcbiAgICBvcmdhbml6YXRpb25JZDogdC5zdHJpbmcoKS5pbmRleCgnYnRyZWUnKSxcbiAgICBuYW1lOiB0LnN0cmluZygpLFxuICAgIGNvbG9yOiB0LnN0cmluZygpLFxuICB9LFxuKTtcblxuY29uc3QgaXNzdWUgPSB0YWJsZShcbiAgeyBuYW1lOiAnaXNzdWUnIH0sXG4gIHtcbiAgICBpZDogdC5zdHJpbmcoKS5wcmltYXJ5S2V5KCksXG4gICAgaWRlbnRpZmllcjogdC5zdHJpbmcoKS51bmlxdWUoKSxcbiAgICBvcmdhbml6YXRpb25JZDogdC5zdHJpbmcoKS5pbmRleCgnYnRyZWUnKSxcbiAgICB0ZWFtSWQ6IHQuc3RyaW5nKCkuaW5kZXgoJ2J0cmVlJyksXG4gICAgcHJvamVjdElkOiB0LnN0cmluZygpLmluZGV4KCdidHJlZScpLFxuICAgIHRpdGxlOiB0LnN0cmluZygpLFxuICAgIGRlc2NyaXB0aW9uOiB0LnN0cmluZygpLFxuICAgIHN0YXR1czogdC5zdHJpbmcoKS5pbmRleCgnYnRyZWUnKSxcbiAgICBwcmlvcml0eTogdC5zdHJpbmcoKS5pbmRleCgnYnRyZWUnKSxcbiAgICBhc3NpZ25lZU5hbWU6IHQuc3RyaW5nKCkuaW5kZXgoJ2J0cmVlJyksXG4gICAgYm9hcmRQb3NpdGlvbjogdC51MzIoKS5pbmRleCgnYnRyZWUnKSxcbiAgICBzb3J0S2V5OiB0LnN0cmluZygpLmluZGV4KCdidHJlZScpLFxuICAgIHJldmlzaW9uOiB0LnU2NCgpLFxuICAgIGNyZWF0ZWRBdDogdC50aW1lc3RhbXAoKSxcbiAgICB1cGRhdGVkQXQ6IHQudGltZXN0YW1wKCksXG4gICAgY3VzdG9tZXJJbXBhY3Q6IHQuc3RyaW5nKCkuZGVmYXVsdCgnbm9ybWFsJykuaW5kZXgoJ2J0cmVlJyksXG4gIH0sXG4pO1xuXG5jb25zdCBpc3N1ZUxhYmVsID0gdGFibGUoXG4gIHsgbmFtZTogJ2lzc3VlX2xhYmVsJyB9LFxuICB7XG4gICAgaWQ6IHQuc3RyaW5nKCkucHJpbWFyeUtleSgpLFxuICAgIGlzc3VlSWQ6IHQuc3RyaW5nKCkuaW5kZXgoJ2J0cmVlJyksXG4gICAgbGFiZWxJZDogdC5zdHJpbmcoKS5pbmRleCgnYnRyZWUnKSxcbiAgfSxcbik7XG5cbmNvbnN0IGNvbW1lbnQgPSB0YWJsZShcbiAgeyBuYW1lOiAnY29tbWVudCcgfSxcbiAge1xuICAgIGlkOiB0LnU2NCgpLnByaW1hcnlLZXkoKS5hdXRvSW5jKCksXG4gICAgaXNzdWVJZDogdC5zdHJpbmcoKS5pbmRleCgnYnRyZWUnKSxcbiAgICBhdXRob3I6IHQuaWRlbnRpdHkoKS5pbmRleCgnYnRyZWUnKSxcbiAgICBhdXRob3JOYW1lOiB0LnN0cmluZygpLFxuICAgIGJvZHk6IHQuc3RyaW5nKCksXG4gICAgY3JlYXRlZEF0OiB0LnRpbWVzdGFtcCgpLFxuICB9LFxuKTtcblxuY29uc3QgYWN0aXZpdHkgPSB0YWJsZShcbiAgeyBuYW1lOiAnYWN0aXZpdHknIH0sXG4gIHtcbiAgICBpZDogdC51NjQoKS5wcmltYXJ5S2V5KCkuYXV0b0luYygpLFxuICAgIGlzc3VlSWQ6IHQuc3RyaW5nKCkuaW5kZXgoJ2J0cmVlJyksXG4gICAgYWN0b3I6IHQuaWRlbnRpdHkoKS5pbmRleCgnYnRyZWUnKSxcbiAgICBhY3Rvck5hbWU6IHQuc3RyaW5nKCksXG4gICAga2luZDogdC5zdHJpbmcoKS5pbmRleCgnYnRyZWUnKSxcbiAgICBkZXRhaWw6IHQuc3RyaW5nKCksXG4gICAgY3JlYXRlZEF0OiB0LnRpbWVzdGFtcCgpLFxuICB9LFxuKTtcblxuY29uc3QgcGFnZVJlc3VsdCA9IHRhYmxlKFxuICB7IG5hbWU6ICdwYWdlX3Jlc3VsdCcgfSxcbiAge1xuICAgIGlkOiB0LnN0cmluZygpLnByaW1hcnlLZXkoKSxcbiAgICByZXF1ZXN0SWQ6IHQuc3RyaW5nKCkuaW5kZXgoJ2J0cmVlJyksXG4gICAgb3duZXI6IHQuaWRlbnRpdHkoKS5pbmRleCgnYnRyZWUnKSxcbiAgICBpc3N1ZUlkOiB0LnN0cmluZygpLFxuICAgIGlkZW50aWZpZXI6IHQuc3RyaW5nKCksXG4gICAgdGl0bGU6IHQuc3RyaW5nKCksXG4gICAgc3RhdHVzOiB0LnN0cmluZygpLFxuICAgIHByaW9yaXR5OiB0LnN0cmluZygpLFxuICAgIGFzc2lnbmVlTmFtZTogdC5zdHJpbmcoKSxcbiAgICBwcm9qZWN0SWQ6IHQuc3RyaW5nKCksXG4gICAgYm9hcmRQb3NpdGlvbjogdC51MzIoKSxcbiAgICBzb3J0S2V5OiB0LnN0cmluZygpLFxuICAgIHJldmlzaW9uOiB0LnU2NCgpLFxuICB9LFxuKTtcblxuY29uc3Qgc3BhY2V0aW1lZGIgPSBzY2hlbWEoe1xuICBwZXJzb25hLFxuICBvcmdhbml6YXRpb24sXG4gIG9yZ2FuaXphdGlvbk1lbWJlcnNoaXAsXG4gIHRlYW0sXG4gIHRlYW1NZW1iZXJzaGlwLFxuICBwcm9qZWN0LFxuICBsYWJlbCxcbiAgaXNzdWUsXG4gIGlzc3VlTGFiZWwsXG4gIGNvbW1lbnQsXG4gIGFjdGl2aXR5LFxuICBwYWdlUmVzdWx0LFxufSk7XG5cbmV4cG9ydCBkZWZhdWx0IHNwYWNldGltZWRiO1xuXG5jb25zdCBQUklNQVJZX09SR0FOSVpBVElPTiA9ICdvcmctcHJpbWFyeSc7XG5jb25zdCBTRUNPTkRBUllfT1JHQU5JWkFUSU9OID0gJ29yZy1zZWNvbmRhcnknO1xuY29uc3QgU1RBVFVTRVMgPSBbJ2JhY2tsb2cnLCAndG9kbycsICdpbi1wcm9ncmVzcycsICdyZXZpZXcnLCAnZG9uZSddO1xuY29uc3QgUFJJT1JJVElFUyA9IFsndXJnZW50JywgJ2hpZ2gnLCAnbWVkaXVtJywgJ2xvdyddO1xuXG5mdW5jdGlvbiBpZGVudGl0eUtleShpZGVudGl0eTogSWRlbnRpdHkpOiBzdHJpbmcge1xuICByZXR1cm4gaWRlbnRpdHkudG9IZXhTdHJpbmcoKTtcbn1cblxuZnVuY3Rpb24gcmVxdWlyZVBlcnNvbmEoY3R4OiBhbnkpIHtcbiAgY29uc3Qgcm93ID0gY3R4LmRiLnBlcnNvbmEuaWRlbnRpdHkuZmluZChjdHguc2VuZGVyKTtcbiAgaWYgKCFyb3cpIHRocm93IG5ldyBFcnJvcignTElORUFSX1BFUlNPTkFfUkVRVUlSRUQnKTtcbiAgcmV0dXJuIHJvdztcbn1cblxuZnVuY3Rpb24gYWN0aXZlT3JnYW5pemF0aW9uTWVtYmVyc2hpcChjdHg6IGFueSwgaWRlbnRpdHk6IElkZW50aXR5LCBvcmdhbml6YXRpb25JZDogc3RyaW5nKSB7XG4gIGNvbnN0IGlkID0gYCR7b3JnYW5pemF0aW9uSWR9OiR7aWRlbnRpdHlLZXkoaWRlbnRpdHkpfWA7XG4gIGNvbnN0IHJvdyA9IGN0eC5kYi5vcmdhbml6YXRpb25NZW1iZXJzaGlwLmlkLmZpbmQoaWQpO1xuICByZXR1cm4gcm93Py5hY3RpdmUgPyByb3cgOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGFjdGl2ZVRlYW1NZW1iZXJzaGlwKGN0eDogYW55LCBpZGVudGl0eTogSWRlbnRpdHksIHRlYW1JZDogc3RyaW5nKSB7XG4gIGNvbnN0IGlkID0gYCR7dGVhbUlkfToke2lkZW50aXR5S2V5KGlkZW50aXR5KX1gO1xuICBjb25zdCByb3cgPSBjdHguZGIudGVhbU1lbWJlcnNoaXAuaWQuZmluZChpZCk7XG4gIHJldHVybiByb3c/LmFjdGl2ZSA/IHJvdyA6IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gY2FuUmVhZElzc3VlKFxuICBjdHg6IGFueSxcbiAgdGFyZ2V0OiB7IG9yZ2FuaXphdGlvbklkOiBzdHJpbmc7IHRlYW1JZDogc3RyaW5nIH0sXG4pOiBib29sZWFuIHtcbiAgY29uc3Qgb3JnYW5pemF0aW9uUm9sZSA9IGFjdGl2ZU9yZ2FuaXphdGlvbk1lbWJlcnNoaXAoXG4gICAgY3R4LFxuICAgIGN0eC5zZW5kZXIsXG4gICAgdGFyZ2V0Lm9yZ2FuaXphdGlvbklkLFxuICApO1xuICBpZiAob3JnYW5pemF0aW9uUm9sZT8ucm9sZSA9PT0gJ293bmVyJykgcmV0dXJuIHRydWU7XG4gIHJldHVybiBCb29sZWFuKGFjdGl2ZVRlYW1NZW1iZXJzaGlwKGN0eCwgY3R4LnNlbmRlciwgdGFyZ2V0LnRlYW1JZCkpO1xufVxuXG5mdW5jdGlvbiByZXF1aXJlUmVhZGFibGVJc3N1ZShjdHg6IGFueSwgaXNzdWVJZDogc3RyaW5nKSB7XG4gIHJlcXVpcmVQZXJzb25hKGN0eCk7XG4gIGNvbnN0IHRhcmdldCA9IGN0eC5kYi5pc3N1ZS5pZC5maW5kKGlzc3VlSWQpO1xuICBpZiAoIXRhcmdldCB8fCAhY2FuUmVhZElzc3VlKGN0eCwgdGFyZ2V0KSkgdGhyb3cgbmV3IEVycm9yKCdMSU5FQVJfTk9UX0FVVEhPUklaRUQnKTtcbiAgcmV0dXJuIHRhcmdldDtcbn1cblxuZnVuY3Rpb24gcmVxdWlyZU93bmVyKGN0eDogYW55KSB7XG4gIGNvbnN0IGFjdG9yID0gcmVxdWlyZVBlcnNvbmEoY3R4KTtcbiAgY29uc3QgbWVtYmVyc2hpcCA9IGFjdGl2ZU9yZ2FuaXphdGlvbk1lbWJlcnNoaXAoY3R4LCBjdHguc2VuZGVyLCBQUklNQVJZX09SR0FOSVpBVElPTik7XG4gIGlmICghbWVtYmVyc2hpcCB8fCBtZW1iZXJzaGlwLnJvbGUgIT09ICdvd25lcicpIHRocm93IG5ldyBFcnJvcignTElORUFSX09XTkVSX1JFUVVJUkVEJyk7XG4gIHJldHVybiBhY3Rvcjtcbn1cblxuZnVuY3Rpb24gYWRkQWN0aXZpdHkoXG4gIGN0eDogYW55LFxuICBpc3N1ZUlkOiBzdHJpbmcsXG4gIGFjdG9yOiB7IGlkZW50aXR5OiBJZGVudGl0eTsgbmFtZTogc3RyaW5nIH0sXG4gIGtpbmQ6IHN0cmluZyxcbiAgZGV0YWlsOiBzdHJpbmcsXG4pIHtcbiAgY3R4LmRiLmFjdGl2aXR5Lmluc2VydCh7XG4gICAgaWQ6IDBuLFxuICAgIGlzc3VlSWQsXG4gICAgYWN0b3I6IGFjdG9yLmlkZW50aXR5LFxuICAgIGFjdG9yTmFtZTogYWN0b3IubmFtZSxcbiAgICBraW5kLFxuICAgIGRldGFpbCxcbiAgICBjcmVhdGVkQXQ6IGN0eC50aW1lc3RhbXAsXG4gIH0pO1xufVxuXG5leHBvcnQgY29uc3QgcmVnaXN0ZXJQZXJzb25hID0gc3BhY2V0aW1lZGIucmVkdWNlcihcbiAgeyBuYW1lOiB0LnN0cmluZygpIH0sXG4gIChjdHgsIHsgbmFtZSB9KSA9PiB7XG4gICAgaWYgKCFbJ0FsaWNlJywgJ0JvYicsICdNYWxsb3J5J10uaW5jbHVkZXMobmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTElORUFSX1VOS05PV05fUEVSU09OQScpO1xuICAgIH1cbiAgICBjb25zdCBjdXJyZW50ID0gY3R4LmRiLnBlcnNvbmEuaWRlbnRpdHkuZmluZChjdHguc2VuZGVyKTtcbiAgICBpZiAoY3VycmVudCAmJiBjdXJyZW50Lm5hbWUgIT09IG5hbWUpIHRocm93IG5ldyBFcnJvcignTElORUFSX0lERU5USVRZX0FMUkVBRFlfQk9VTkQnKTtcbiAgICBjb25zdCBjbGFpbWVkID0gY3R4LmRiLnBlcnNvbmEubmFtZS5maW5kKG5hbWUpO1xuICAgIGlmIChjbGFpbWVkICYmIGlkZW50aXR5S2V5KGNsYWltZWQuaWRlbnRpdHkpICE9PSBpZGVudGl0eUtleShjdHguc2VuZGVyKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdMSU5FQVJfUEVSU09OQV9BTFJFQURZX0NMQUlNRUQnKTtcbiAgICB9XG4gICAgaWYgKCFjdXJyZW50KSBjdHguZGIucGVyc29uYS5pbnNlcnQoeyBpZGVudGl0eTogY3R4LnNlbmRlciwgbmFtZSB9KTtcbiAgfSxcbik7XG5cbmV4cG9ydCBjb25zdCBzZWVkRml4dHVyZXMgPSBzcGFjZXRpbWVkYi5yZWR1Y2VyKChjdHgpID0+IHtcbiAgY29uc3QgYWN0b3IgPSByZXF1aXJlUGVyc29uYShjdHgpO1xuICBpZiAoYWN0b3IubmFtZSAhPT0gJ0FsaWNlJykgdGhyb3cgbmV3IEVycm9yKCdMSU5FQVJfT05MWV9BTElDRV9TRUVEUycpO1xuICBpZiAoY3R4LmRiLm9yZ2FuaXphdGlvbi5pZC5maW5kKFBSSU1BUllfT1JHQU5JWkFUSU9OKSkge1xuICAgIHRocm93IG5ldyBFcnJvcignTElORUFSX0ZJWFRVUkVfQUxSRUFEWV9TRUVERUQnKTtcbiAgfVxuICBjb25zdCBhbGljZSA9IGN0eC5kYi5wZXJzb25hLm5hbWUuZmluZCgnQWxpY2UnKTtcbiAgY29uc3QgYm9iID0gY3R4LmRiLnBlcnNvbmEubmFtZS5maW5kKCdCb2InKTtcbiAgY29uc3QgbWFsbG9yeSA9IGN0eC5kYi5wZXJzb25hLm5hbWUuZmluZCgnTWFsbG9yeScpO1xuICBpZiAoIWFsaWNlIHx8ICFib2IgfHwgIW1hbGxvcnkpIHRocm93IG5ldyBFcnJvcignTElORUFSX0FMTF9QRVJTT05BU19SRVFVSVJFRCcpO1xuXG4gIGN0eC5kYi5vcmdhbml6YXRpb24uaW5zZXJ0KHsgaWQ6IFBSSU1BUllfT1JHQU5JWkFUSU9OLCBuYW1lOiAnQWNtZSBTeXN0ZW1zJyB9KTtcbiAgY3R4LmRiLm9yZ2FuaXphdGlvbi5pbnNlcnQoeyBpZDogU0VDT05EQVJZX09SR0FOSVpBVElPTiwgbmFtZTogJ0NvbnRyb2wgT3JnYW5pemF0aW9uJyB9KTtcbiAgY3R4LmRiLm9yZ2FuaXphdGlvbk1lbWJlcnNoaXAuaW5zZXJ0KHtcbiAgICBpZDogYCR7UFJJTUFSWV9PUkdBTklaQVRJT059OiR7aWRlbnRpdHlLZXkoYWxpY2UuaWRlbnRpdHkpfWAsXG4gICAgb3JnYW5pemF0aW9uSWQ6IFBSSU1BUllfT1JHQU5JWkFUSU9OLFxuICAgIGlkZW50aXR5OiBhbGljZS5pZGVudGl0eSxcbiAgICByb2xlOiAnb3duZXInLFxuICAgIGFjdGl2ZTogdHJ1ZSxcbiAgfSk7XG4gIGN0eC5kYi5vcmdhbml6YXRpb25NZW1iZXJzaGlwLmluc2VydCh7XG4gICAgaWQ6IGAke1BSSU1BUllfT1JHQU5JWkFUSU9OfToke2lkZW50aXR5S2V5KGJvYi5pZGVudGl0eSl9YCxcbiAgICBvcmdhbml6YXRpb25JZDogUFJJTUFSWV9PUkdBTklaQVRJT04sXG4gICAgaWRlbnRpdHk6IGJvYi5pZGVudGl0eSxcbiAgICByb2xlOiAnbWVtYmVyJyxcbiAgICBhY3RpdmU6IHRydWUsXG4gIH0pO1xuXG4gIGNvbnN0IHRlYW1zID0gWydQbGF0Zm9ybScsICdDbGllbnQnLCAnSW5mcmFzdHJ1Y3R1cmUnXS5tYXAoKG5hbWUsIGluZGV4KSA9PiAoe1xuICAgIGlkOiBgdGVhbS0ke2luZGV4ICsgMX1gLFxuICAgIG9yZ2FuaXphdGlvbklkOiBQUklNQVJZX09SR0FOSVpBVElPTixcbiAgICBuYW1lLFxuICB9KSk7XG4gIGZvciAoY29uc3QgdGFyZ2V0IG9mIHRlYW1zKSB7XG4gICAgY3R4LmRiLnRlYW0uaW5zZXJ0KHRhcmdldCk7XG4gICAgZm9yIChjb25zdCBtZW1iZXIgb2YgW1xuICAgICAgeyBpZGVudGl0eTogYWxpY2UuaWRlbnRpdHksIHJvbGU6ICdvd25lcicgfSxcbiAgICAgIHsgaWRlbnRpdHk6IGJvYi5pZGVudGl0eSwgcm9sZTogJ21lbWJlcicgfSxcbiAgICBdKSB7XG4gICAgICBjdHguZGIudGVhbU1lbWJlcnNoaXAuaW5zZXJ0KHtcbiAgICAgICAgaWQ6IGAke3RhcmdldC5pZH06JHtpZGVudGl0eUtleShtZW1iZXIuaWRlbnRpdHkpfWAsXG4gICAgICAgIHRlYW1JZDogdGFyZ2V0LmlkLFxuICAgICAgICBpZGVudGl0eTogbWVtYmVyLmlkZW50aXR5LFxuICAgICAgICByb2xlOiBtZW1iZXIucm9sZSxcbiAgICAgICAgYWN0aXZlOiB0cnVlLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgcHJvamVjdHMgPSBbJ0F0bGFzJywgJ0JlYWNvbicsICdDb21ldCcsICdEZWx0YSddLm1hcCgobmFtZSwgaW5kZXgpID0+ICh7XG4gICAgaWQ6IGBwcm9qZWN0LSR7aW5kZXggKyAxfWAsXG4gICAgb3JnYW5pemF0aW9uSWQ6IFBSSU1BUllfT1JHQU5JWkFUSU9OLFxuICAgIHRlYW1JZDogdGVhbXNbaW5kZXggJSB0ZWFtcy5sZW5ndGhdLmlkLFxuICAgIG5hbWUsXG4gIH0pKTtcbiAgZm9yIChjb25zdCB0YXJnZXQgb2YgcHJvamVjdHMpIGN0eC5kYi5wcm9qZWN0Lmluc2VydCh0YXJnZXQpO1xuXG4gIGNvbnN0IGxhYmVscyA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDIwIH0sIChfLCBpbmRleCkgPT4gKHtcbiAgICBpZDogYGxhYmVsLSR7U3RyaW5nKGluZGV4ICsgMSkucGFkU3RhcnQoMiwgJzAnKX1gLFxuICAgIG9yZ2FuaXphdGlvbklkOiBQUklNQVJZX09SR0FOSVpBVElPTixcbiAgICBuYW1lOiBgTGFiZWwgJHtTdHJpbmcoaW5kZXggKyAxKS5wYWRTdGFydCgyLCAnMCcpfWAsXG4gICAgY29sb3I6IGBoc2woJHtpbmRleCAqIDE4fSA2MCUgNTUlKWAsXG4gIH0pKTtcbiAgZm9yIChjb25zdCB0YXJnZXQgb2YgbGFiZWxzKSBjdHguZGIubGFiZWwuaW5zZXJ0KHRhcmdldCk7XG5cbiAgZm9yIChsZXQgb3JkaW5hbCA9IDE7IG9yZGluYWwgPD0gNTAwOyBvcmRpbmFsICs9IDEpIHtcbiAgICBjb25zdCBpZCA9IGBpc3N1ZS0ke1N0cmluZyhvcmRpbmFsKS5wYWRTdGFydCgzLCAnMCcpfWA7XG4gICAgY29uc3QgdGVhbUlkID0gdGVhbXNbKG9yZGluYWwgLSAxKSAlIHRlYW1zLmxlbmd0aF0uaWQ7XG4gICAgY29uc3QgcHJvamVjdElkID0gcHJvamVjdHNbKG9yZGluYWwgLSAxKSAlIHByb2plY3RzLmxlbmd0aF0uaWQ7XG4gICAgY29uc3Qgc3RhdHVzID0gU1RBVFVTRVNbKG9yZGluYWwgLSAxKSAlIFNUQVRVU0VTLmxlbmd0aF07XG4gICAgY29uc3QgcHJpb3JpdHkgPSBQUklPUklUSUVTWyhvcmRpbmFsIC0gMSkgJSBQUklPUklUSUVTLmxlbmd0aF07XG4gICAgY29uc3QgYXNzaWduZWVOYW1lID0gb3JkaW5hbCAlIDIgPT09IDAgPyAnQWxpY2UnIDogJ0JvYic7XG4gICAgY3R4LmRiLmlzc3VlLmluc2VydCh7XG4gICAgICBpZCxcbiAgICAgIGlkZW50aWZpZXI6IGBMSU4tJHtTdHJpbmcob3JkaW5hbCkucGFkU3RhcnQoMywgJzAnKX1gLFxuICAgICAgb3JnYW5pemF0aW9uSWQ6IFBSSU1BUllfT1JHQU5JWkFUSU9OLFxuICAgICAgdGVhbUlkLFxuICAgICAgcHJvamVjdElkLFxuICAgICAgdGl0bGU6IGBQcm9kdWN0aW9uIGlzc3VlICR7U3RyaW5nKG9yZGluYWwpLnBhZFN0YXJ0KDMsICcwJyl9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiBgRGV0ZXJtaW5pc3RpYyBwcm9kdWN0aW9uLXNoYXBlZCBkZXNjcmlwdGlvbiBmb3IgaXNzdWUgJHtvcmRpbmFsfS5gLFxuICAgICAgc3RhdHVzLFxuICAgICAgcHJpb3JpdHksXG4gICAgICBhc3NpZ25lZU5hbWUsXG4gICAgICBib2FyZFBvc2l0aW9uOiBvcmRpbmFsIC0gMSxcbiAgICAgIHNvcnRLZXk6IGAke1N0cmluZyhvcmRpbmFsKS5wYWRTdGFydCg2LCAnMCcpfToke2lkfWAsXG4gICAgICByZXZpc2lvbjogMW4sXG4gICAgICBjdXN0b21lckltcGFjdDogJ25vcm1hbCcsXG4gICAgICBjcmVhdGVkQXQ6IGN0eC50aW1lc3RhbXAsXG4gICAgICB1cGRhdGVkQXQ6IGN0eC50aW1lc3RhbXAsXG4gICAgfSk7XG4gICAgZm9yIChjb25zdCBsYWJlbE9mZnNldCBvZiBbMCwgN10pIHtcbiAgICAgIGNvbnN0IGxhYmVsSWQgPSBsYWJlbHNbKG9yZGluYWwgLSAxICsgbGFiZWxPZmZzZXQpICUgbGFiZWxzLmxlbmd0aF0uaWQ7XG4gICAgICBjdHguZGIuaXNzdWVMYWJlbC5pbnNlcnQoe1xuICAgICAgICBpZDogYCR7aWR9OiR7bGFiZWxJZH1gLFxuICAgICAgICBpc3N1ZUlkOiBpZCxcbiAgICAgICAgbGFiZWxJZCxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBmb3IgKGxldCBjb21tZW50SW5kZXggPSAxOyBjb21tZW50SW5kZXggPD0gMjsgY29tbWVudEluZGV4ICs9IDEpIHtcbiAgICAgIGNvbnN0IGF1dGhvciA9IGNvbW1lbnRJbmRleCAlIDIgPT09IDEgPyBhbGljZSA6IGJvYjtcbiAgICAgIGN0eC5kYi5jb21tZW50Lmluc2VydCh7XG4gICAgICAgIGlkOiAwbixcbiAgICAgICAgaXNzdWVJZDogaWQsXG4gICAgICAgIGF1dGhvcjogYXV0aG9yLmlkZW50aXR5LFxuICAgICAgICBhdXRob3JOYW1lOiBhdXRob3IubmFtZSxcbiAgICAgICAgYm9keTogYEZpeHR1cmUgY29tbWVudCAke2NvbW1lbnRJbmRleH0gZm9yIExJTi0ke1N0cmluZyhvcmRpbmFsKS5wYWRTdGFydCgzLCAnMCcpfWAsXG4gICAgICAgIGNyZWF0ZWRBdDogY3R4LnRpbWVzdGFtcCxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBhZGRBY3Rpdml0eShjdHgsIGlkLCBhbGljZSwgJ3NlZWRlZCcsICdJc3N1ZSBjcmVhdGVkIGJ5IGRldGVybWluaXN0aWMgc2VlZCcpO1xuICB9XG59KTtcblxuZXhwb3J0IGNvbnN0IHJlcXVlc3RJc3N1ZVBhZ2UgPSBzcGFjZXRpbWVkYi5yZWR1Y2VyKFxuICB7XG4gICAgcmVxdWVzdElkOiB0LnN0cmluZygpLFxuICAgIHN0YXR1czogdC5zdHJpbmcoKSxcbiAgICBhc3NpZ25lZU5hbWU6IHQuc3RyaW5nKCksXG4gICAgcHJvamVjdElkOiB0LnN0cmluZygpLFxuICAgIGxhYmVsSWQ6IHQuc3RyaW5nKCksXG4gICAgYWZ0ZXJTb3J0S2V5OiB0LnN0cmluZygpLFxuICB9LFxuICAoY3R4LCBmaWx0ZXJzKSA9PiB7XG4gICAgcmVxdWlyZVBlcnNvbmEoY3R4KTtcbiAgICBjb25zdCBvd25lZFJlcXVlc3QgPSBgJHtpZGVudGl0eUtleShjdHguc2VuZGVyKX06JHtmaWx0ZXJzLnJlcXVlc3RJZH1gO1xuICAgIGZvciAoY29uc3Qgb2xkIG9mIEFycmF5LmZyb20oY3R4LmRiLnBhZ2VSZXN1bHQucmVxdWVzdElkLmZpbHRlcihvd25lZFJlcXVlc3QpKSkge1xuICAgICAgY3R4LmRiLnBhZ2VSZXN1bHQuaWQuZGVsZXRlKG9sZC5pZCk7XG4gICAgfVxuXG4gICAgbGV0IGNhbmRpZGF0ZXM6IEFycmF5PHR5cGVvZiBpc3N1ZS5yb3dUeXBlLnR5cGU+O1xuICAgIGlmIChmaWx0ZXJzLnN0YXR1cykge1xuICAgICAgY2FuZGlkYXRlcyA9IEFycmF5LmZyb20oY3R4LmRiLmlzc3VlLnN0YXR1cy5maWx0ZXIoZmlsdGVycy5zdGF0dXMpKTtcbiAgICB9IGVsc2UgaWYgKGZpbHRlcnMuYXNzaWduZWVOYW1lKSB7XG4gICAgICBjYW5kaWRhdGVzID0gQXJyYXkuZnJvbShjdHguZGIuaXNzdWUuYXNzaWduZWVOYW1lLmZpbHRlcihmaWx0ZXJzLmFzc2lnbmVlTmFtZSkpO1xuICAgIH0gZWxzZSBpZiAoZmlsdGVycy5wcm9qZWN0SWQpIHtcbiAgICAgIGNhbmRpZGF0ZXMgPSBBcnJheS5mcm9tKGN0eC5kYi5pc3N1ZS5wcm9qZWN0SWQuZmlsdGVyKGZpbHRlcnMucHJvamVjdElkKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNhbmRpZGF0ZXMgPSBBcnJheS5mcm9tKGN0eC5kYi5pc3N1ZS5vcmdhbml6YXRpb25JZC5maWx0ZXIoUFJJTUFSWV9PUkdBTklaQVRJT04pKTtcbiAgICB9XG4gICAgY29uc3Qgcm93cyA9IGNhbmRpZGF0ZXNcbiAgICAgIC5maWx0ZXIoKHJvdykgPT4gY2FuUmVhZElzc3VlKGN0eCwgcm93KSlcbiAgICAgIC5maWx0ZXIoKHJvdykgPT4gIWZpbHRlcnMuc3RhdHVzIHx8IHJvdy5zdGF0dXMgPT09IGZpbHRlcnMuc3RhdHVzKVxuICAgICAgLmZpbHRlcigocm93KSA9PiAhZmlsdGVycy5hc3NpZ25lZU5hbWUgfHwgcm93LmFzc2lnbmVlTmFtZSA9PT0gZmlsdGVycy5hc3NpZ25lZU5hbWUpXG4gICAgICAuZmlsdGVyKChyb3cpID0+ICFmaWx0ZXJzLnByb2plY3RJZCB8fCByb3cucHJvamVjdElkID09PSBmaWx0ZXJzLnByb2plY3RJZClcbiAgICAgIC5maWx0ZXIoKHJvdykgPT4gIWZpbHRlcnMubGFiZWxJZCB8fCBCb29sZWFuKFxuICAgICAgICBjdHguZGIuaXNzdWVMYWJlbC5pZC5maW5kKGAke3Jvdy5pZH06JHtmaWx0ZXJzLmxhYmVsSWR9YCksXG4gICAgICApKVxuICAgICAgLmZpbHRlcigocm93KSA9PiAhZmlsdGVycy5hZnRlclNvcnRLZXkgfHwgcm93LnNvcnRLZXkgPiBmaWx0ZXJzLmFmdGVyU29ydEtleSlcbiAgICAgIC5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5zb3J0S2V5LmxvY2FsZUNvbXBhcmUocmlnaHQuc29ydEtleSkpXG4gICAgICAuc2xpY2UoMCwgNTApO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGN0eC5kYi5wYWdlUmVzdWx0Lmluc2VydCh7XG4gICAgICAgIGlkOiBgJHtvd25lZFJlcXVlc3R9OiR7cm93LmlkfWAsXG4gICAgICAgIHJlcXVlc3RJZDogb3duZWRSZXF1ZXN0LFxuICAgICAgICBvd25lcjogY3R4LnNlbmRlcixcbiAgICAgICAgaXNzdWVJZDogcm93LmlkLFxuICAgICAgICBpZGVudGlmaWVyOiByb3cuaWRlbnRpZmllcixcbiAgICAgICAgdGl0bGU6IHJvdy50aXRsZSxcbiAgICAgICAgc3RhdHVzOiByb3cuc3RhdHVzLFxuICAgICAgICBwcmlvcml0eTogcm93LnByaW9yaXR5LFxuICAgICAgICBhc3NpZ25lZU5hbWU6IHJvdy5hc3NpZ25lZU5hbWUsXG4gICAgICAgIHByb2plY3RJZDogcm93LnByb2plY3RJZCxcbiAgICAgICAgYm9hcmRQb3NpdGlvbjogcm93LmJvYXJkUG9zaXRpb24sXG4gICAgICAgIHNvcnRLZXk6IHJvdy5zb3J0S2V5LFxuICAgICAgICByZXZpc2lvbjogcm93LnJldmlzaW9uLFxuICAgICAgfSk7XG4gICAgfVxuICB9LFxuKTtcblxuZXhwb3J0IGNvbnN0IGNyZWF0ZUlzc3VlID0gc3BhY2V0aW1lZGIucmVkdWNlcihcbiAge1xuICAgIGlkOiB0LnN0cmluZygpLFxuICAgIGlkZW50aWZpZXI6IHQuc3RyaW5nKCksXG4gICAgdGVhbUlkOiB0LnN0cmluZygpLFxuICAgIHByb2plY3RJZDogdC5zdHJpbmcoKSxcbiAgICB0aXRsZTogdC5zdHJpbmcoKSxcbiAgICBzdGF0dXM6IHQuc3RyaW5nKCksXG4gICAgcHJpb3JpdHk6IHQuc3RyaW5nKCksXG4gICAgYXNzaWduZWVOYW1lOiB0LnN0cmluZygpLFxuICAgIGJvYXJkUG9zaXRpb246IHQudTMyKCksXG4gICAgc29ydEtleTogdC5zdHJpbmcoKSxcbiAgfSxcbiAgKGN0eCwgaW5wdXQpID0+IHtcbiAgICBjb25zdCBhY3RvciA9IHJlcXVpcmVQZXJzb25hKGN0eCk7XG4gICAgY29uc3QgYXV0aG9yaXphdGlvblByb2JlID0ge1xuICAgICAgb3JnYW5pemF0aW9uSWQ6IFBSSU1BUllfT1JHQU5JWkFUSU9OLFxuICAgICAgdGVhbUlkOiBpbnB1dC50ZWFtSWQsXG4gICAgfTtcbiAgICBpZiAoIWNhblJlYWRJc3N1ZShjdHgsIGF1dGhvcml6YXRpb25Qcm9iZSkpIHRocm93IG5ldyBFcnJvcignTElORUFSX05PVF9BVVRIT1JJWkVEJyk7XG4gICAgaWYgKGN0eC5kYi5pc3N1ZS5pZC5maW5kKGlucHV0LmlkKSkgdGhyb3cgbmV3IEVycm9yKCdMSU5FQVJfRFVQTElDQVRFX0lTU1VFJyk7XG4gICAgaWYgKCFjdHguZGIucHJvamVjdC5pZC5maW5kKGlucHV0LnByb2plY3RJZCkpIHRocm93IG5ldyBFcnJvcignTElORUFSX1BST0pFQ1RfTk9UX0ZPVU5EJyk7XG4gICAgY3R4LmRiLmlzc3VlLmluc2VydCh7XG4gICAgICAuLi5pbnB1dCxcbiAgICAgIG9yZ2FuaXphdGlvbklkOiBQUklNQVJZX09SR0FOSVpBVElPTixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ3JlYXRlZCBkdXJpbmcgYWNjZXB0YW5jZS4nLFxuICAgICAgcmV2aXNpb246IDFuLFxuICAgICAgY3VzdG9tZXJJbXBhY3Q6ICdub3JtYWwnLFxuICAgICAgY3JlYXRlZEF0OiBjdHgudGltZXN0YW1wLFxuICAgICAgdXBkYXRlZEF0OiBjdHgudGltZXN0YW1wLFxuICAgIH0pO1xuICAgIGFkZEFjdGl2aXR5KGN0eCwgaW5wdXQuaWQsIGFjdG9yLCAnY3JlYXRlZCcsIGlucHV0LnRpdGxlKTtcbiAgfSxcbik7XG5cbmV4cG9ydCBjb25zdCB1cGRhdGVJc3N1ZSA9IHNwYWNldGltZWRiLnJlZHVjZXIoXG4gIHtcbiAgICBpc3N1ZUlkOiB0LnN0cmluZygpLFxuICAgIGV4cGVjdGVkUmV2aXNpb246IHQudTY0KCksXG4gICAgc3RhdHVzOiB0LnN0cmluZygpLFxuICAgIHByaW9yaXR5OiB0LnN0cmluZygpLFxuICAgIGFzc2lnbmVlTmFtZTogdC5zdHJpbmcoKSxcbiAgICBib2FyZFBvc2l0aW9uOiB0LnUzMigpLFxuICB9LFxuICAoY3R4LCBpbnB1dCkgPT4ge1xuICAgIGNvbnN0IGFjdG9yID0gcmVxdWlyZVBlcnNvbmEoY3R4KTtcbiAgICBjb25zdCBjdXJyZW50ID0gcmVxdWlyZVJlYWRhYmxlSXNzdWUoY3R4LCBpbnB1dC5pc3N1ZUlkKTtcbiAgICBpZiAoY3VycmVudC5yZXZpc2lvbiAhPT0gaW5wdXQuZXhwZWN0ZWRSZXZpc2lvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdMSU5FQVJfUkVWSVNJT05fQ09ORkxJQ1QnKTtcbiAgICB9XG4gICAgY3R4LmRiLmlzc3VlLmlkLnVwZGF0ZSh7XG4gICAgICAuLi5jdXJyZW50LFxuICAgICAgc3RhdHVzOiBpbnB1dC5zdGF0dXMsXG4gICAgICBwcmlvcml0eTogaW5wdXQucHJpb3JpdHksXG4gICAgICBhc3NpZ25lZU5hbWU6IGlucHV0LmFzc2lnbmVlTmFtZSxcbiAgICAgIGJvYXJkUG9zaXRpb246IGlucHV0LmJvYXJkUG9zaXRpb24sXG4gICAgICByZXZpc2lvbjogY3VycmVudC5yZXZpc2lvbiArIDFuLFxuICAgICAgdXBkYXRlZEF0OiBjdHgudGltZXN0YW1wLFxuICAgIH0pO1xuICAgIGFkZEFjdGl2aXR5KFxuICAgICAgY3R4LFxuICAgICAgY3VycmVudC5pZCxcbiAgICAgIGFjdG9yLFxuICAgICAgJ3VwZGF0ZWQnLFxuICAgICAgYHJldmlzaW9uICR7Y3VycmVudC5yZXZpc2lvbi50b1N0cmluZygpfSAtPiAkeyhjdXJyZW50LnJldmlzaW9uICsgMW4pLnRvU3RyaW5nKCl9YCxcbiAgICApO1xuICB9LFxuKTtcblxuZXhwb3J0IGNvbnN0IGFkZENvbW1lbnQgPSBzcGFjZXRpbWVkYi5yZWR1Y2VyKFxuICB7IGlzc3VlSWQ6IHQuc3RyaW5nKCksIGJvZHk6IHQuc3RyaW5nKCkgfSxcbiAgKGN0eCwgeyBpc3N1ZUlkLCBib2R5IH0pID0+IHtcbiAgICBjb25zdCBhY3RvciA9IHJlcXVpcmVQZXJzb25hKGN0eCk7XG4gICAgcmVxdWlyZVJlYWRhYmxlSXNzdWUoY3R4LCBpc3N1ZUlkKTtcbiAgICBpZiAoIWJvZHkgfHwgYm9keS5sZW5ndGggPiA0MDAwKSB0aHJvdyBuZXcgRXJyb3IoJ0xJTkVBUl9JTlZBTElEX0NPTU1FTlQnKTtcbiAgICBjdHguZGIuY29tbWVudC5pbnNlcnQoe1xuICAgICAgaWQ6IDBuLFxuICAgICAgaXNzdWVJZCxcbiAgICAgIGF1dGhvcjogY3R4LnNlbmRlcixcbiAgICAgIGF1dGhvck5hbWU6IGFjdG9yLm5hbWUsXG4gICAgICBib2R5LFxuICAgICAgY3JlYXRlZEF0OiBjdHgudGltZXN0YW1wLFxuICAgIH0pO1xuICAgIGFkZEFjdGl2aXR5KGN0eCwgaXNzdWVJZCwgYWN0b3IsICdjb21tZW50ZWQnLCBib2R5LnNsaWNlKDAsIDEyMCkpO1xuICB9LFxuKTtcblxuZXhwb3J0IGNvbnN0IHNldEN1c3RvbWVySW1wYWN0ID0gc3BhY2V0aW1lZGIucmVkdWNlcihcbiAge1xuICAgIGlzc3VlSWQ6IHQuc3RyaW5nKCksXG4gICAgZXhwZWN0ZWRSZXZpc2lvbjogdC51NjQoKSxcbiAgICBjdXN0b21lckltcGFjdDogdC5zdHJpbmcoKSxcbiAgfSxcbiAgKGN0eCwgeyBpc3N1ZUlkLCBleHBlY3RlZFJldmlzaW9uLCBjdXN0b21lckltcGFjdCB9KSA9PiB7XG4gICAgY29uc3QgYWN0b3IgPSByZXF1aXJlUGVyc29uYShjdHgpO1xuICAgIGNvbnN0IGN1cnJlbnQgPSByZXF1aXJlUmVhZGFibGVJc3N1ZShjdHgsIGlzc3VlSWQpO1xuICAgIGlmIChjdXJyZW50LnJldmlzaW9uICE9PSBleHBlY3RlZFJldmlzaW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0xJTkVBUl9SRVZJU0lPTl9DT05GTElDVCcpO1xuICAgIH1cbiAgICBpZiAoIVsnbG93JywgJ25vcm1hbCcsICdoaWdoJywgJ2NyaXRpY2FsJ10uaW5jbHVkZXMoY3VzdG9tZXJJbXBhY3QpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0xJTkVBUl9JTlZBTElEX0NVU1RPTUVSX0lNUEFDVCcpO1xuICAgIH1cbiAgICBjdHguZGIuaXNzdWUuaWQudXBkYXRlKHtcbiAgICAgIC4uLmN1cnJlbnQsXG4gICAgICBjdXN0b21lckltcGFjdCxcbiAgICAgIHJldmlzaW9uOiBjdXJyZW50LnJldmlzaW9uICsgMW4sXG4gICAgICB1cGRhdGVkQXQ6IGN0eC50aW1lc3RhbXAsXG4gICAgfSk7XG4gICAgYWRkQWN0aXZpdHkoXG4gICAgICBjdHgsXG4gICAgICBpc3N1ZUlkLFxuICAgICAgYWN0b3IsXG4gICAgICAnY3VzdG9tZXItaW1wYWN0JyxcbiAgICAgIGN1c3RvbWVySW1wYWN0LFxuICAgICk7XG4gIH0sXG4pO1xuXG5leHBvcnQgY29uc3Qgb3duZXJPbmx5UHJvYmUgPSBzcGFjZXRpbWVkYi5yZWR1Y2VyKChjdHgpID0+IHtcbiAgcmVxdWlyZU93bmVyKGN0eCk7XG59KTtcblxuZXhwb3J0IGNvbnN0IG15T3JnYW5pemF0aW9ucyA9IHNwYWNldGltZWRiLnZpZXcoXG4gIHsgbmFtZTogJ215X29yZ2FuaXphdGlvbnMnLCBwdWJsaWM6IHRydWUgfSxcbiAgdC5hcnJheShvcmdhbml6YXRpb24ucm93VHlwZSksXG4gIChjdHgpID0+IHtcbiAgICBjb25zdCByb3dzID0gW107XG4gICAgZm9yIChjb25zdCBtZW1iZXJzaGlwIG9mIGN0eC5kYi5vcmdhbml6YXRpb25NZW1iZXJzaGlwLmlkZW50aXR5LmZpbHRlcihjdHguc2VuZGVyKSkge1xuICAgICAgaWYgKCFtZW1iZXJzaGlwLmFjdGl2ZSkgY29udGludWU7XG4gICAgICBjb25zdCB0YXJnZXQgPSBjdHguZGIub3JnYW5pemF0aW9uLmlkLmZpbmQobWVtYmVyc2hpcC5vcmdhbml6YXRpb25JZCk7XG4gICAgICBpZiAodGFyZ2V0KSByb3dzLnB1c2godGFyZ2V0KTtcbiAgICB9XG4gICAgcmV0dXJuIHJvd3M7XG4gIH0sXG4pO1xuXG5leHBvcnQgY29uc3QgbXlUZWFtcyA9IHNwYWNldGltZWRiLnZpZXcoXG4gIHsgbmFtZTogJ215X3RlYW1zJywgcHVibGljOiB0cnVlIH0sXG4gIHQuYXJyYXkodGVhbS5yb3dUeXBlKSxcbiAgKGN0eCkgPT4ge1xuICAgIGNvbnN0IHJvd3M6IEFycmF5PHR5cGVvZiB0ZWFtLnJvd1R5cGUudHlwZT4gPSBbXTtcbiAgICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCBtZW1iZXJzaGlwIG9mIGN0eC5kYi5vcmdhbml6YXRpb25NZW1iZXJzaGlwLmlkZW50aXR5LmZpbHRlcihjdHguc2VuZGVyKSkge1xuICAgICAgaWYgKCFtZW1iZXJzaGlwLmFjdGl2ZSB8fCBtZW1iZXJzaGlwLnJvbGUgIT09ICdvd25lcicpIGNvbnRpbnVlO1xuICAgICAgZm9yIChjb25zdCB0YXJnZXQgb2YgY3R4LmRiLnRlYW0ub3JnYW5pemF0aW9uSWQuZmlsdGVyKG1lbWJlcnNoaXAub3JnYW5pemF0aW9uSWQpKSB7XG4gICAgICAgIHJvd3MucHVzaCh0YXJnZXQpO1xuICAgICAgICBzZWVuLmFkZCh0YXJnZXQuaWQpO1xuICAgICAgfVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IG1lbWJlcnNoaXAgb2YgY3R4LmRiLnRlYW1NZW1iZXJzaGlwLmlkZW50aXR5LmZpbHRlcihjdHguc2VuZGVyKSkge1xuICAgICAgaWYgKCFtZW1iZXJzaGlwLmFjdGl2ZSB8fCBzZWVuLmhhcyhtZW1iZXJzaGlwLnRlYW1JZCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgdGFyZ2V0ID0gY3R4LmRiLnRlYW0uaWQuZmluZChtZW1iZXJzaGlwLnRlYW1JZCk7XG4gICAgICBpZiAodGFyZ2V0KSByb3dzLnB1c2godGFyZ2V0KTtcbiAgICB9XG4gICAgcmV0dXJuIHJvd3M7XG4gIH0sXG4pO1xuXG5leHBvcnQgY29uc3QgbXlQcm9qZWN0cyA9IHNwYWNldGltZWRiLnZpZXcoXG4gIHsgbmFtZTogJ215X3Byb2plY3RzJywgcHVibGljOiB0cnVlIH0sXG4gIHQuYXJyYXkocHJvamVjdC5yb3dUeXBlKSxcbiAgKGN0eCkgPT4ge1xuICAgIGNvbnN0IHJvd3M6IEFycmF5PHR5cGVvZiBwcm9qZWN0LnJvd1R5cGUudHlwZT4gPSBbXTtcbiAgICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCBtZW1iZXJzaGlwIG9mIGN0eC5kYi5vcmdhbml6YXRpb25NZW1iZXJzaGlwLmlkZW50aXR5LmZpbHRlcihjdHguc2VuZGVyKSkge1xuICAgICAgaWYgKCFtZW1iZXJzaGlwLmFjdGl2ZSkgY29udGludWU7XG4gICAgICBmb3IgKGNvbnN0IHRhcmdldCBvZiBjdHguZGIucHJvamVjdC5vcmdhbml6YXRpb25JZC5maWx0ZXIobWVtYmVyc2hpcC5vcmdhbml6YXRpb25JZCkpIHtcbiAgICAgICAgaWYgKCFzZWVuLmhhcyh0YXJnZXQuaWQpKSByb3dzLnB1c2godGFyZ2V0KTtcbiAgICAgICAgc2Vlbi5hZGQodGFyZ2V0LmlkKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJvd3M7XG4gIH0sXG4pO1xuXG5leHBvcnQgY29uc3QgbXlMYWJlbHMgPSBzcGFjZXRpbWVkYi52aWV3KFxuICB7IG5hbWU6ICdteV9sYWJlbHMnLCBwdWJsaWM6IHRydWUgfSxcbiAgdC5hcnJheShsYWJlbC5yb3dUeXBlKSxcbiAgKGN0eCkgPT4ge1xuICAgIGNvbnN0IHJvd3M6IEFycmF5PHR5cGVvZiBsYWJlbC5yb3dUeXBlLnR5cGU+ID0gW107XG4gICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGZvciAoY29uc3QgbWVtYmVyc2hpcCBvZiBjdHguZGIub3JnYW5pemF0aW9uTWVtYmVyc2hpcC5pZGVudGl0eS5maWx0ZXIoY3R4LnNlbmRlcikpIHtcbiAgICAgIGlmICghbWVtYmVyc2hpcC5hY3RpdmUpIGNvbnRpbnVlO1xuICAgICAgZm9yIChjb25zdCB0YXJnZXQgb2YgY3R4LmRiLmxhYmVsLm9yZ2FuaXphdGlvbklkLmZpbHRlcihtZW1iZXJzaGlwLm9yZ2FuaXphdGlvbklkKSkge1xuICAgICAgICBpZiAoIXNlZW4uaGFzKHRhcmdldC5pZCkpIHJvd3MucHVzaCh0YXJnZXQpO1xuICAgICAgICBzZWVuLmFkZCh0YXJnZXQuaWQpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcm93cztcbiAgfSxcbik7XG5cbmV4cG9ydCBjb25zdCBteUlzc3VlcyA9IHNwYWNldGltZWRiLnZpZXcoXG4gIHsgbmFtZTogJ215X2lzc3VlcycsIHB1YmxpYzogdHJ1ZSB9LFxuICB0LmFycmF5KGlzc3VlLnJvd1R5cGUpLFxuICAoY3R4KSA9PiB7XG4gICAgY29uc3Qgcm93czogQXJyYXk8dHlwZW9mIGlzc3VlLnJvd1R5cGUudHlwZT4gPSBbXTtcbiAgICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCBtZW1iZXJzaGlwIG9mIGN0eC5kYi5vcmdhbml6YXRpb25NZW1iZXJzaGlwLmlkZW50aXR5LmZpbHRlcihjdHguc2VuZGVyKSkge1xuICAgICAgaWYgKCFtZW1iZXJzaGlwLmFjdGl2ZSB8fCBtZW1iZXJzaGlwLnJvbGUgIT09ICdvd25lcicpIGNvbnRpbnVlO1xuICAgICAgZm9yIChjb25zdCB0YXJnZXQgb2YgY3R4LmRiLmlzc3VlLm9yZ2FuaXphdGlvbklkLmZpbHRlcihtZW1iZXJzaGlwLm9yZ2FuaXphdGlvbklkKSkge1xuICAgICAgICByb3dzLnB1c2godGFyZ2V0KTtcbiAgICAgICAgc2Vlbi5hZGQodGFyZ2V0LmlkKTtcbiAgICAgIH1cbiAgICB9XG4gICAgZm9yIChjb25zdCBtZW1iZXJzaGlwIG9mIGN0eC5kYi50ZWFtTWVtYmVyc2hpcC5pZGVudGl0eS5maWx0ZXIoY3R4LnNlbmRlcikpIHtcbiAgICAgIGlmICghbWVtYmVyc2hpcC5hY3RpdmUpIGNvbnRpbnVlO1xuICAgICAgZm9yIChjb25zdCB0YXJnZXQgb2YgY3R4LmRiLmlzc3VlLnRlYW1JZC5maWx0ZXIobWVtYmVyc2hpcC50ZWFtSWQpKSB7XG4gICAgICAgIGlmICghc2Vlbi5oYXModGFyZ2V0LmlkKSkgcm93cy5wdXNoKHRhcmdldCk7XG4gICAgICAgIHNlZW4uYWRkKHRhcmdldC5pZCk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByb3dzO1xuICB9LFxuKTtcblxuZXhwb3J0IGNvbnN0IG15SXNzdWVMYWJlbHMgPSBzcGFjZXRpbWVkYi52aWV3KFxuICB7IG5hbWU6ICdteV9pc3N1ZV9sYWJlbHMnLCBwdWJsaWM6IHRydWUgfSxcbiAgdC5hcnJheShpc3N1ZUxhYmVsLnJvd1R5cGUpLFxuICAoY3R4KSA9PiB7XG4gICAgY29uc3Qgcm93czogQXJyYXk8dHlwZW9mIGlzc3VlTGFiZWwucm93VHlwZS50eXBlPiA9IFtdO1xuICAgIGZvciAoY29uc3QgdGFyZ2V0IG9mIGN0eC5kYi5pc3N1ZS5vcmdhbml6YXRpb25JZC5maWx0ZXIoUFJJTUFSWV9PUkdBTklaQVRJT04pKSB7XG4gICAgICBpZiAoIWNhblJlYWRJc3N1ZShjdHgsIHRhcmdldCkpIGNvbnRpbnVlO1xuICAgICAgcm93cy5wdXNoKC4uLkFycmF5LmZyb20oY3R4LmRiLmlzc3VlTGFiZWwuaXNzdWVJZC5maWx0ZXIodGFyZ2V0LmlkKSkpO1xuICAgIH1cbiAgICByZXR1cm4gcm93cztcbiAgfSxcbik7XG5cbmV4cG9ydCBjb25zdCBteUNvbW1lbnRzID0gc3BhY2V0aW1lZGIudmlldyhcbiAgeyBuYW1lOiAnbXlfY29tbWVudHMnLCBwdWJsaWM6IHRydWUgfSxcbiAgdC5hcnJheShjb21tZW50LnJvd1R5cGUpLFxuICAoY3R4KSA9PiB7XG4gICAgY29uc3Qgcm93czogQXJyYXk8dHlwZW9mIGNvbW1lbnQucm93VHlwZS50eXBlPiA9IFtdO1xuICAgIGZvciAoY29uc3QgdGFyZ2V0IG9mIGN0eC5kYi5pc3N1ZS5vcmdhbml6YXRpb25JZC5maWx0ZXIoUFJJTUFSWV9PUkdBTklaQVRJT04pKSB7XG4gICAgICBpZiAoIWNhblJlYWRJc3N1ZShjdHgsIHRhcmdldCkpIGNvbnRpbnVlO1xuICAgICAgcm93cy5wdXNoKC4uLkFycmF5LmZyb20oY3R4LmRiLmNvbW1lbnQuaXNzdWVJZC5maWx0ZXIodGFyZ2V0LmlkKSkpO1xuICAgIH1cbiAgICByZXR1cm4gcm93cztcbiAgfSxcbik7XG5cbmV4cG9ydCBjb25zdCBteUFjdGl2aXRpZXMgPSBzcGFjZXRpbWVkYi52aWV3KFxuICB7IG5hbWU6ICdteV9hY3Rpdml0aWVzJywgcHVibGljOiB0cnVlIH0sXG4gIHQuYXJyYXkoYWN0aXZpdHkucm93VHlwZSksXG4gIChjdHgpID0+IHtcbiAgICBjb25zdCByb3dzOiBBcnJheTx0eXBlb2YgYWN0aXZpdHkucm93VHlwZS50eXBlPiA9IFtdO1xuICAgIGZvciAoY29uc3QgdGFyZ2V0IG9mIGN0eC5kYi5pc3N1ZS5vcmdhbml6YXRpb25JZC5maWx0ZXIoUFJJTUFSWV9PUkdBTklaQVRJT04pKSB7XG4gICAgICBpZiAoIWNhblJlYWRJc3N1ZShjdHgsIHRhcmdldCkpIGNvbnRpbnVlO1xuICAgICAgcm93cy5wdXNoKC4uLkFycmF5LmZyb20oY3R4LmRiLmFjdGl2aXR5Lmlzc3VlSWQuZmlsdGVyKHRhcmdldC5pZCkpKTtcbiAgICB9XG4gICAgcmV0dXJuIHJvd3M7XG4gIH0sXG4pO1xuXG5leHBvcnQgY29uc3QgbXlQYWdlUmVzdWx0cyA9IHNwYWNldGltZWRiLnZpZXcoXG4gIHsgbmFtZTogJ215X3BhZ2VfcmVzdWx0cycsIHB1YmxpYzogdHJ1ZSB9LFxuICB0LmFycmF5KHBhZ2VSZXN1bHQucm93VHlwZSksXG4gIChjdHgpID0+IEFycmF5LmZyb20oY3R4LmRiLnBhZ2VSZXN1bHQub3duZXIuZmlsdGVyKGN0eC5zZW5kZXIpKSxcbik7XG4iXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsSUFBSUEsYUFBVyxPQUFPO0FBQ3RCLElBQUlDLGNBQVksT0FBTztBQUN2QixJQUFJQyxxQkFBbUIsT0FBTztBQUM5QixJQUFJQyxzQkFBb0IsT0FBTztBQUMvQixJQUFJQyxpQkFBZSxPQUFPO0FBQzFCLElBQUlDLGlCQUFlLE9BQU8sVUFBVTtBQUNwQyxJQUFJQyxnQkFBYyxJQUFJLFFBQVEsU0FBUyxZQUFZO0FBQ2pELFFBQU8sUUFBUSxHQUFHLEdBQUdILG9CQUFrQixHQUFHLENBQUMsTUFB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LElBQUksR0FBRyxRQUFRLFFBQVEsT0FBTyxPQUFPLEdBQUcsQ0FBQyxDQUFDOztBQUVwRSxRQUFPO0VBRVY7QUFFRCxNQUFhLGVBQWUsWUFBWSxLQUN0QztDQUFFLE1BQU07Q0FBaUIsUUFBUTtDQUFNLEVBQ3ZDLEVBQUUsTUFBTSxTQUFTLFFBQVEsR0FDeEIsUUFBUTtDQUNQLE1BQU0sT0FBNEMsRUFBRTtBQUNwRCxNQUFLLE1BQU0sVUFBVSxJQUFJLEdBQUcsTUFBTSxlQUFlLE9BQU8scUJBQXFCLEVBQUU7QUFDN0UsTUFBSSxDQUFDLGFBQWEsS0FBSyxPQUFPLENBQUU7QUFDaEMsT0FBSyxLQUFLLEdBQUcsTUFBTSxLQUFLLElBQUksR0FBRyxTQUFTLFFBQVEsT0FBTyxPQUFPLEdBQUcsQ0FBQyxDQUFDOztBQUVyRSxRQUFPO0VBRVY7QUFFRCxNQUFhLGdCQUFnQixZQUFZLEtBQ3ZDO0NBQUUsTUFBTTtDQUFtQixRQUFRO0NBQU0sRUFDekMsRUFBRSxNQUFNLFdBQVcsUUFBUSxHQUMxQixRQUFRLE1BQU0sS0FBSyxJQUFJLEdBQUcsV0FBVyxNQUFNLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FDaEUiLCJkZWJ1Z0lkIjoiMDllNWU4ZTItODAyYy00OGRjLTgxZDItY2M3YTNkZTY3NmIyIn0=