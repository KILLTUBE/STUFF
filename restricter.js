
/**
 * almond 0.0.3 Copyright (c) 2011, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
/*jslint strict: false, plusplus: false */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {

    var defined = {},
        waiting = {},
        aps = [].slice,
        main, req;

    if (typeof define === "function") {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that "directory" and not name of the baseName's
                //module. For instance, baseName of "one/two/three", maps to
                //"one/two/three.js", but we want the directory, "one/two" for
                //this normalization.
                baseName = baseName.split("/");
                baseName = baseName.slice(0, baseName.length - 1);

                name = baseName.concat(name.split("/"));

                //start trimDots
                var i, part;
                for (i = 0; (part = name[i]); i++) {
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            }
        }
        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            return req.apply(undef, aps.call(arguments, 0).concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (waiting.hasOwnProperty(name)) {
            var args = waiting[name];
            delete waiting[name];
            main.apply(undef, args);
        }
        return defined[name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    function makeMap(name, relName) {
        var prefix, plugin,
            index = name.indexOf('!');

        if (index !== -1) {
            prefix = normalize(name.slice(0, index), relName);
            name = name.slice(index + 1);
            plugin = callDep(prefix);

            //Normalize according
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            p: plugin
        };
    }

    main = function (name, deps, callback, relName) {
        var args = [],
            usingExports,
            cjsModule, depName, i, ret, map;

        //Use name if no relName
        if (!relName) {
            relName = name;
        }

        //Call the callback to define the module, if necessary.
        if (typeof callback === 'function') {

            //Default to require, exports, module if no deps if
            //the factory arg has any arguments specified.
            if (!deps.length && callback.length) {
                deps = ['require', 'exports', 'module'];
            }

            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            for (i = 0; i < deps.length; i++) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = makeRequire(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = defined[name] = {};
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = {
                        id: name,
                        uri: '',
                        exports: defined[name]
                    };
                } else if (defined.hasOwnProperty(depName) || waiting.hasOwnProperty(depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw name + ' missing ' + depName;
                }
            }

            ret = callback.apply(defined[name], args);

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef) {
                    defined[name] = cjsModule.exports;
                } else if (!usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = req = function (deps, callback, relName, forceSync) {
        if (typeof deps === "string") {

            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            //Drop the config stuff on the ground.
            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = arguments[2];
            } else {
                deps = [];
            }
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 15);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function () {
        return req;
    };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    define = function (name, deps, callback) {

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (define.unordered) {
            waiting[name] = [name, deps, callback];
        } else {
            main(name, deps, callback);
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("../build/almond.js", function(){});

// ECMAScript3 versions of ECMAScript5 constructs used in Narcissus parser
// All properties will be writable, configurable and enumerable, no matter
// the descriptor. Descriptor get/set is also ignored.


define('jsecma5',[], function() {
    if (Object.defineProperty === undefined) {
        Object.defineProperty = function(obj, prop, descriptor) {
            obj[prop] = descriptor.value;
        };
    }

    if (Object.defineProperties === undefined) {
        Object.defineProperties = function(obj, props) {
            for (var prop in props) {
                if (props.hasOwnProperty(prop)) {
                    Object.defineProperty(obj, prop, props[prop]);
                }
            }
        };
    }

    if (Object.create === undefined) {
        Object.create = function(obj, props) {
            function ctor() {}
            ctor.prototype = obj;
            var o = new ctor();
            if (props !== undefined) {
                Object.defineProperties(o, props);
            }
            return o;
        };
    }
});



define('narcissus/lib/n',[], function() {
    return {
        options: {
            version: 185,
            // Global variables to hide from the interpreter
            hiddenHostGlobals: { Narcissus: true },
            // Desugar SpiderMonkey language extensions?
            desugarExtensions: false,
            // Allow HTML comments?
            allowHTMLComments: false
        },
        hostSupportsEvalConst: (function() {
            try {
                return eval("(function(s) { eval(s); return x })('const x = true;')");
            } catch (e) {
                return false;
            }
        })(),
        hostGlobal: this
    };
});

/* vim: set sw=4 ts=4 et tw=78: */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the Narcissus JavaScript engine.
 *
 * The Initial Developer of the Original Code is
 * Brendan Eich <brendan@mozilla.org>.
 * Portions created by the Initial Developer are Copyright (C) 2004
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Tom Austin <taustin@ucsc.edu>
 *   Brendan Eich <brendan@mozilla.org>
 *   Shu-Yu Guo <shu@rfrn.org>
 *   Dave Herman <dherman@mozilla.com>
 *   Dimitris Vardoulakis <dimvar@ccs.neu.edu>
 *   Patrick Walton <pcwalton@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Narcissus - JS implemented in JS.
 *
 * Well-known constants and lookup tables.  Many consts are generated from the
 * tokens table via eval to minimize redundancy, so consumers must be compiled
 * separately to take advantage of the simple switch-case constant propagation
 * done by SpiderMonkey.
 */



define('narcissus/lib/jsdefs',['./n'], function(Narcissus) {

Narcissus.definitions = (function(hostGlobal) {

    var tokens = [
        // End of source.
        "END",

        // Operators and punctuators.  Some pair-wise order matters, e.g. (+, -)
        // and (UNARY_PLUS, UNARY_MINUS).
        "\n", ";",
        ",",
        "=",
        "?", ":", "CONDITIONAL",
        "||",
        "&&",
        "|",
        "^",
        "&",
        "==", "!=", "===", "!==",
        "<", "<=", ">=", ">",
        "<<", ">>", ">>>",
        "+", "-",
        "*", "/", "%",
        "!", "~", "UNARY_PLUS", "UNARY_MINUS",
        "++", "--",
        ".",
        "[", "]",
        "{", "}",
        "(", ")",

        // Nonterminal tree node type codes.
        "SCRIPT", "BLOCK", "LABEL", "FOR_IN", "CALL", "NEW_WITH_ARGS", "INDEX",
        "ARRAY_INIT", "OBJECT_INIT", "PROPERTY_INIT", "GETTER", "SETTER",
        "GROUP", "LIST", "LET_BLOCK", "ARRAY_COMP", "GENERATOR", "COMP_TAIL",

        // Terminals.
        "IDENTIFIER", "NUMBER", "STRING", "REGEXP",

        // Keywords.
        "break",
        "case", "catch", "const", "continue",
        "debugger", "default", "delete", "do",
        "else", "export",
        "false", "finally", "for", "function",
        "if", "import", "in", "instanceof",
        "let", "module",
        "new", "null",
        "return",
        "switch",
        "this", "throw", "true", "try", "typeof",
        "var", "void",
        "yield",
        "while", "with",
    ];

    var statementStartTokens = [
        "break",
        "const", "continue",
        "debugger", "do",
        "for",
        "if",
        "return",
        "switch",
        "throw", "try",
        "var",
        "yield",
        "while", "with",
    ];

    // Whitespace characters (see ECMA-262 7.2)
    var whitespaceChars = [
        // normal whitespace:
        "\u0009", "\u000B", "\u000C", "\u0020", "\u00A0", "\uFEFF",

        // high-Unicode whitespace:
        "\u1680", "\u180E",
        "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006",
        "\u2007", "\u2008", "\u2009", "\u200A",
        "\u202F", "\u205F", "\u3000"
    ];

    var whitespace = {};
    for (var i = 0; i < whitespaceChars.length; i++) {
        whitespace[whitespaceChars[i]] = true;
    }

    // Operator and punctuator mapping from token to tree node type name.
    // NB: because the lexer doesn't backtrack, all token prefixes must themselves
    // be valid tokens (e.g. !== is acceptable because its prefixes are the valid
    // tokens != and !).
    var opTypeNames = {
        '\n':   "NEWLINE",
        ';':    "SEMICOLON",
        ',':    "COMMA",
        '?':    "HOOK",
        ':':    "COLON",
        '||':   "OR",
        '&&':   "AND",
        '|':    "BITWISE_OR",
        '^':    "BITWISE_XOR",
        '&':    "BITWISE_AND",
        '===':  "STRICT_EQ",
        '==':   "EQ",
        '=':    "ASSIGN",
        '!==':  "STRICT_NE",
        '!=':   "NE",
        '<<':   "LSH",
        '<=':   "LE",
        '<':    "LT",
        '>>>':  "URSH",
        '>>':   "RSH",
        '>=':   "GE",
        '>':    "GT",
        '++':   "INCREMENT",
        '--':   "DECREMENT",
        '+':    "PLUS",
        '-':    "MINUS",
        '*':    "MUL",
        '/':    "DIV",
        '%':    "MOD",
        '!':    "NOT",
        '~':    "BITWISE_NOT",
        '.':    "DOT",
        '[':    "LEFT_BRACKET",
        ']':    "RIGHT_BRACKET",
        '{':    "LEFT_CURLY",
        '}':    "RIGHT_CURLY",
        '(':    "LEFT_PAREN",
        ')':    "RIGHT_PAREN"
    };

    // Hash of keyword identifier to tokens index.  NB: we must null __proto__ to
    // avoid toString, etc. namespace pollution.
    var keywords = Object.create(null);

    // Define const END, etc., based on the token names.  Also map name to index.
    var tokenIds = {};

    // Building up a string to be eval'd in different contexts.
    var consts = Narcissus.hostSupportsEvalConst ? "const " : "var ";
    for (var i = 0, j = tokens.length; i < j; i++) {
        if (i > 0)
            consts += ", ";
        var t = tokens[i];
        var name;
        if (/^[a-z]/.test(t)) {
            name = t.toUpperCase();
            keywords[t] = i;
        } else {
            name = (/^\W/.test(t) ? opTypeNames[t] : t);
        }
        consts += name + " = " + i;
        tokenIds[name] = i;
        tokens[t] = i;
    }
    consts += ";";

    var isStatementStartCode = Object.create(null);
    for (i = 0, j = statementStartTokens.length; i < j; i++)
        isStatementStartCode[keywords[statementStartTokens[i]]] = true;

    // Map assignment operators to their indexes in the tokens array.
    var assignOps = ['|', '^', '&', '<<', '>>', '>>>', '+', '-', '*', '/', '%'];

    for (i = 0, j = assignOps.length; i < j; i++) {
        t = assignOps[i];
        assignOps[t] = tokens[t];
    }

    function defineGetter(obj, prop, fn, dontDelete, dontEnum) {
        Object.defineProperty(obj, prop,
                              { get: fn, configurable: !dontDelete, enumerable: !dontEnum });
    }

    function defineGetterSetter(obj, prop, getter, setter, dontDelete, dontEnum) {
        Object.defineProperty(obj, prop, {
            get: getter,
            set: setter,
            configurable: !dontDelete,
            enumerable: !dontEnum
        });
    }

    function defineMemoGetter(obj, prop, fn, dontDelete, dontEnum) {
        Object.defineProperty(obj, prop, {
            get: function() {
                var val = fn();
                defineProperty(obj, prop, val, dontDelete, true, dontEnum);
                return val;
            },
            configurable: true,
            enumerable: !dontEnum
        });
    }

    function defineProperty(obj, prop, val, dontDelete, readOnly, dontEnum) {
        Object.defineProperty(obj, prop,
                              { value: val, writable: !readOnly, configurable: !dontDelete,
                                enumerable: !dontEnum });
    }

    // Returns true if fn is a native function.  (Note: SpiderMonkey specific.)
    function isNativeCode(fn) {
        // Relies on the toString method to identify native code.
        return ((typeof fn) === "function") && fn.toString().match(/\[native code\]/);
    }

    var Fpapply = Function.prototype.apply;

    function apply(f, o, a) {
        return Fpapply.call(f, [o].concat(a));
    }

    var applyNew;

    // ES5's bind is a simpler way to implement applyNew
    if (Function.prototype.bind) {
        applyNew = function applyNew(f, a) {
            return new (f.bind.apply(f, [,].concat(a)))();
        };
    } else {
        applyNew = function applyNew(f, a) {
            switch (a.length) {
              case 0:
                return new f();
              case 1:
                return new f(a[0]);
              case 2:
                return new f(a[0], a[1]);
              case 3:
                return new f(a[0], a[1], a[2]);
              default:
                var argStr = "a[0]";
                for (var i = 1, n = a.length; i < n; i++)
                    argStr += ",a[" + i + "]";
                return eval("new f(" + argStr + ")");
            }
        };
    }

    function getPropertyDescriptor(obj, name) {
        while (obj) {
            if (({}).hasOwnProperty.call(obj, name))
                return Object.getOwnPropertyDescriptor(obj, name);
            obj = Object.getPrototypeOf(obj);
        }
    }

    function getPropertyNames(obj) {
        var table = Object.create(null, {});
        while (obj) {
            var names = Object.getOwnPropertyNames(obj);
            for (var i = 0, n = names.length; i < n; i++)
                table[names[i]] = true;
            obj = Object.getPrototypeOf(obj);
        }
        return Object.keys(table);
    }

    function getOwnProperties(obj) {
        var map = {};
        for (var name in Object.getOwnPropertyNames(obj))
            map[name] = Object.getOwnPropertyDescriptor(obj, name);
        return map;
    }

    function blacklistHandler(target, blacklist) {
        var mask = Object.create(null, {});
        var redirect = Dict.create(blacklist).mapObject(function(name) { return mask; });
        return mixinHandler(redirect, target);
    }

    function whitelistHandler(target, whitelist) {
        var catchall = Object.create(null, {});
        var redirect = Dict.create(whitelist).mapObject(function(name) { return target; });
        return mixinHandler(redirect, catchall);
    }

    function mirrorHandler(target, writable) {
        var handler = makePassthruHandler(target);

        var defineProperty = handler.defineProperty;
        handler.defineProperty = function(name, desc) {
            if (!desc.enumerable)
                throw new Error("mirror property must be enumerable");
            if (!desc.configurable)
                throw new Error("mirror property must be configurable");
            if (desc.writable !== writable)
                throw new Error("mirror property must " + (writable ? "" : "not ") + "be writable");
            defineProperty(name, desc);
        };

        handler.fix = function() { };
        handler.getOwnPropertyDescriptor = handler.getPropertyDescriptor;
        handler.getOwnPropertyNames = getPropertyNames.bind(handler, target);
        handler.keys = handler.enumerate;
        handler["delete"] = function() { return false; };
        handler.hasOwn = handler.has;
        return handler;
    }

    /*
     * Mixin proxies break the single-inheritance model of prototypes, so
     * the handler treats all properties as own-properties:
     *
     *                  X
     *                  |
     *     +------------+------------+
     *     |                 O       |
     *     |                 |       |
     *     |  O         O    O       |
     *     |  |         |    |       |
     *     |  O    O    O    O       |
     *     |  |    |    |    |       |
     *     |  O    O    O    O    O  |
     *     |  |    |    |    |    |  |
     *     +-(*)--(w)--(x)--(y)--(z)-+
     */

    function mixinHandler(redirect, catchall) {
        function targetFor(name) {
            return hasOwn(redirect, name) ? redirect[name] : catchall;
        }

        function getMuxPropertyDescriptor(name) {
            var desc = getPropertyDescriptor(targetFor(name), name);
            if (desc)
                desc.configurable = true;
            return desc;
        }

        function getMuxPropertyNames() {
            var names1 = Object.getOwnPropertyNames(redirect).filter(function(name) {
                return name in redirect[name];
            });
            var names2 = getPropertyNames(catchall).filter(function(name) {
                return !hasOwn(redirect, name);
            });
            return names1.concat(names2);
        }

        function enumerateMux() {
            var result = Object.getOwnPropertyNames(redirect).filter(function(name) {
                return name in redirect[name];
            });
            for (name in catchall) {
                if (!hasOwn(redirect, name))
                    result.push(name);
            };
            return result;
        }

        function hasMux(name) {
            return name in targetFor(name);
        }

        return {
            getOwnPropertyDescriptor: getMuxPropertyDescriptor,
            getPropertyDescriptor: getMuxPropertyDescriptor,
            getOwnPropertyNames: getMuxPropertyNames,
            defineProperty: function(name, desc) {
                Object.defineProperty(targetFor(name), name, desc);
            },
            "delete": function(name) {
                var target = targetFor(name);
                return delete target[name];
            },
            // FIXME: ha ha ha
            fix: function() { },
            has: hasMux,
            hasOwn: hasMux,
            get: function(receiver, name) {
                var target = targetFor(name);
                return target[name];
            },
            set: function(receiver, name, val) {
                var target = targetFor(name);
                target[name] = val;
                return true;
            },
            enumerate: enumerateMux,
            keys: enumerateMux
        };
    }

    function makePassthruHandler(obj) {
        // Handler copied from
        // http://wiki.ecmascript.org/doku.php?id=harmony:proxies&s=proxy%20object#examplea_no-op_forwarding_proxy
        return {
            getOwnPropertyDescriptor: function(name) {
                var desc = Object.getOwnPropertyDescriptor(obj, name);

                // a trapping proxy's properties must always be configurable
                desc.configurable = true;
                return desc;
            },
            getPropertyDescriptor: function(name) {
                var desc = getPropertyDescriptor(obj, name);

                // a trapping proxy's properties must always be configurable
                desc.configurable = true;
                return desc;
            },
            getOwnPropertyNames: function() {
                return Object.getOwnPropertyNames(obj);
            },
            defineProperty: function(name, desc) {
                Object.defineProperty(obj, name, desc);
            },
            "delete": function(name) { return delete obj[name]; },
            fix: function() {
                if (Object.isFrozen(obj)) {
                    return getOwnProperties(obj);
                }

                // As long as obj is not frozen, the proxy won't allow itself to be fixed.
                return undefined; // will cause a TypeError to be thrown
            },

            has: function(name) { return name in obj; },
            hasOwn: function(name) { return ({}).hasOwnProperty.call(obj, name); },
            get: function(receiver, name) { return obj[name]; },

            // bad behavior when set fails in non-strict mode
            set: function(receiver, name, val) { obj[name] = val; return true; },
            enumerate: function() {
                var result = [];
                for (name in obj) { result.push(name); };
                return result;
            },
            keys: function() { return Object.keys(obj); }
        };
    }

    var hasOwnProperty = ({}).hasOwnProperty;

    function hasOwn(obj, name) {
        return hasOwnProperty.call(obj, name);
    }

    function Dict(table, size) {
        this.table = table || Object.create(null, {});
        this.size = size || 0;
    }

    Dict.create = function(table) {
        var init = Object.create(null, {});
        var size = 0;
        var names = Object.getOwnPropertyNames(table);
        for (var i = 0, n = names.length; i < n; i++) {
            var name = names[i];
            init[name] = table[name];
            size++;
        }
        return new Dict(init, size);
    };

    Dict.prototype = {
        has: function(x) { return hasOwnProperty.call(this.table, x); },
        set: function(x, v) {
            if (!hasOwnProperty.call(this.table, x))
                this.size++;
            this.table[x] = v;
        },
        get: function(x) { return this.table[x]; },
        getDef: function(x, thunk) {
            if (!hasOwnProperty.call(this.table, x)) {
                this.size++;
                this.table[x] = thunk();
            }
            return this.table[x];
        },
        forEach: function(f) {
            var table = this.table;
            for (var key in table)
                f.call(this, key, table[key]);
        },
        map: function(f) {
            var table1 = this.table;
            var table2 = Object.create(null, {});
            this.forEach(function(key, val) {
                table2[key] = f.call(this, val, key);
            });
            return new Dict(table2, this.size);
        },
        mapObject: function(f) {
            var table1 = this.table;
            var table2 = Object.create(null, {});
            this.forEach(function(key, val) {
                table2[key] = f.call(this, val, key);
            });
            return table2;
        },
        toObject: function() {
            return this.mapObject(function(val) { return val; });
        },
        choose: function() {
            return Object.getOwnPropertyNames(this.table)[0];
        },
        remove: function(x) {
            if (hasOwnProperty.call(this.table, x)) {
                this.size--;
                delete this.table[x];
            }
        },
        copy: function() {
            var table = Object.create(null, {});
            for (var key in this.table)
                table[key] = this.table[key];
            return new Dict(table, this.size);
        },
        keys: function() {
            return Object.keys(this.table);
        },
        toString: function() { return "[object Dict]" }
    };

    // shim for ES6 WeakMap with poor asymptotics
    function WeakMap(array) {
        this.array = array || [];
    }

    function searchMap(map, key, found, notFound) {
        var a = map.array;
        for (var i = 0, n = a.length; i < n; i++) {
            var pair = a[i];
            if (pair.key === key)
                return found(pair, i);
        }
        return notFound();
    }

    WeakMap.prototype = {
        has: function(x) {
            return searchMap(this, x, function() { return true }, function() { return false });
        },
        set: function(x, v) {
            var a = this.array;
            searchMap(this, x,
                      function(pair) { pair.value = v },
                      function() { a.push({ key: x, value: v }) });
        },
        get: function(x) {
            return searchMap(this, x,
                             function(pair) { return pair.value },
                             function() { return null });
        },
        "delete": function(x) {
            var a = this.array;
            searchMap(this, x,
                      function(pair, i) { a.splice(i, 1) },
                      function() { });
        },
        toString: function() { return "[object WeakMap]" }
    };

    // non-destructive stack
    function Stack(elts) {
        this.elts = elts || null;
    }

    Stack.prototype = {
        push: function(x) {
            return new Stack({ top: x, rest: this.elts });
        },
        top: function() {
            if (!this.elts)
                throw new Error("empty stack");
            return this.elts.top;
        },
        isEmpty: function() {
            return this.top === null;
        },
        find: function(test) {
            for (var elts = this.elts; elts; elts = elts.rest) {
                if (test(elts.top))
                    return elts.top;
            }
            return null;
        },
        has: function(x) {
            return Boolean(this.find(function(elt) { return elt === x }));
        },
        forEach: function(f) {
            for (var elts = this.elts; elts; elts = elts.rest) {
                f(elts.top);
            }
        }
    };

    if (!Array.prototype.copy) {
        defineProperty(Array.prototype, "copy",
                       function() {
                           var result = [];
                           for (var i = 0, n = this.length; i < n; i++)
                               result[i] = this[i];
                           return result;
                       }, false, false, true);
    }

    if (!Array.prototype.top) {
        defineProperty(Array.prototype, "top",
                       function() {
                           return this.length && this[this.length-1];
                       }, false, false, true);
    }

    return {
        tokens: tokens,
        whitespace: whitespace,
        opTypeNames: opTypeNames,
        keywords: keywords,
        isStatementStartCode: isStatementStartCode,
        tokenIds: tokenIds,
        consts: consts,
        assignOps: assignOps,
        defineGetter: defineGetter,
        defineGetterSetter: defineGetterSetter,
        defineMemoGetter: defineMemoGetter,
        defineProperty: defineProperty,
        isNativeCode: isNativeCode,
        apply: apply,
        applyNew: applyNew,
        mirrorHandler: mirrorHandler,
        mixinHandler: mixinHandler,
        whitelistHandler: whitelistHandler,
        blacklistHandler: blacklistHandler,
        makePassthruHandler: makePassthruHandler,
        Dict: Dict,
        WeakMap: (hostGlobal && hostGlobal.WeakMap) || WeakMap,
        Stack: Stack
    };
}(Narcissus.hostGlobal));

    return Narcissus.definitions;
});

/* vim: set sw=4 ts=4 et tw=78: */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the Narcissus JavaScript engine.
 *
 * The Initial Developer of the Original Code is
 * Brendan Eich <brendan@mozilla.org>.
 * Portions created by the Initial Developer are Copyright (C) 2004
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Tom Austin <taustin@ucsc.edu>
 *   Brendan Eich <brendan@mozilla.org>
 *   Shu-Yu Guo <shu@rfrn.org>
 *   Stephan Herhut <stephan.a.herhut@intel.com>
 *   Dave Herman <dherman@mozilla.com>
 *   Dimitris Vardoulakis <dimvar@ccs.neu.edu>
 *   Patrick Walton <pcwalton@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Narcissus - JS implemented in JS.
 *
 * Lexical scanner.
 */



define('narcissus/lib/jslex',['./n','./jsdefs'], function(Narcissus, definitions) {

Narcissus.lexer = (function() {

    var definitions = Narcissus.definitions;

    // Set constants in the local scope.
    var END = 0, NEWLINE = 1, SEMICOLON = 2, COMMA = 3, ASSIGN = 4, HOOK = 5, COLON = 6, CONDITIONAL = 7, OR = 8, AND = 9, BITWISE_OR = 10, BITWISE_XOR = 11, BITWISE_AND = 12, EQ = 13, NE = 14, STRICT_EQ = 15, STRICT_NE = 16, LT = 17, LE = 18, GE = 19, GT = 20, LSH = 21, RSH = 22, URSH = 23, PLUS = 24, MINUS = 25, MUL = 26, DIV = 27, MOD = 28, NOT = 29, BITWISE_NOT = 30, UNARY_PLUS = 31, UNARY_MINUS = 32, INCREMENT = 33, DECREMENT = 34, DOT = 35, LEFT_BRACKET = 36, RIGHT_BRACKET = 37, LEFT_CURLY = 38, RIGHT_CURLY = 39, LEFT_PAREN = 40, RIGHT_PAREN = 41, SCRIPT = 42, BLOCK = 43, LABEL = 44, FOR_IN = 45, CALL = 46, NEW_WITH_ARGS = 47, INDEX = 48, ARRAY_INIT = 49, OBJECT_INIT = 50, PROPERTY_INIT = 51, GETTER = 52, SETTER = 53, GROUP = 54, LIST = 55, LET_BLOCK = 56, ARRAY_COMP = 57, GENERATOR = 58, COMP_TAIL = 59, IDENTIFIER = 60, NUMBER = 61, STRING = 62, REGEXP = 63, BREAK = 64, CASE = 65, CATCH = 66, CONST = 67, CONTINUE = 68, DEBUGGER = 69, DEFAULT = 70, DELETE = 71, DO = 72, ELSE = 73, EXPORT = 74, FALSE = 75, FINALLY = 76, FOR = 77, FUNCTION = 78, IF = 79, IMPORT = 80, IN = 81, INSTANCEOF = 82, LET = 83, MODULE = 84, NEW = 85, NULL = 86, RETURN = 87, SWITCH = 88, THIS = 89, THROW = 90, TRUE = 91, TRY = 92, TYPEOF = 93, VAR = 94, VOID = 95, YIELD = 96, WHILE = 97, WITH = 98;

    // Banned keywords by language version
    var blackLists = { 160: {}, 185: {}, harmony: {} };
    blackLists[160][LET] = true;
    blackLists[160][MODULE] = true;
    blackLists[160][YIELD] = true;
    blackLists[185][MODULE] = true;

    // Build up a trie of operator tokens.
    var opTokens = {};
    for (var op in definitions.opTypeNames) {
        if (op === '\n' || op === '.')
            continue;

        var node = opTokens;
        for (var i = 0; i < op.length; i++) {
            var ch = op[i];
            if (!(ch in node))
                node[ch] = {};
            node = node[ch];
            node.op = op;
        }
    }

    /*
     * Since JavaScript provides no convenient way to determine if a
     * character is in a particular Unicode category, we use
     * metacircularity to accomplish this (oh yeaaaah!)
     */
    function isValidIdentifierChar(ch, first) {
        // check directly for ASCII
        if (ch <= "\u007F") {
            if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '$' || ch === '_' ||
                (!first && (ch >= '0' && ch <= '9'))) {
                return true;
            }
            return false;
        }

        // create an object to test this in
        var x = {};
        x["x"+ch] = true;
        x[ch] = true;

        // then use eval to determine if it's a valid character
        var valid = false;
        try {
            valid = (Function("x", "return (x." + (first?"":"x") + ch + ");")(x) === true);
        } catch (ex) {}

        return valid;
    }

    function isIdentifier(str) {
        if (typeof str !== "string")
            return false;

        if (str.length === 0)
            return false;

        if (!isValidIdentifierChar(str[0], true))
            return false;

        for (var i = 1; i < str.length; i++) {
            if (!isValidIdentifierChar(str[i], false))
                return false;
        }

        return true;
    }

    /*
     * Tokenizer :: (source, filename, line number) -> Tokenizer
     */
    function Tokenizer(s, f, l) {
        this.cursor = 0;
        this.source = String(s);
        this.tokens = [];
        this.tokenIndex = 0;
        this.lookahead = 0;
        this.scanNewlines = false;
        this.unexpectedEOF = false;
        this.filename = f || "";
        this.lineno = l || 1;
        this.blackList = blackLists[Narcissus.options.version];
        this.blockComments = null;
        this.comments = [];
    }

    Tokenizer.prototype = {
        get done() {
            // We need to set scanOperand to true here because the first thing
            // might be a regexp.
            return this.peek(true) === END;
        },

        get token() {
            return this.tokens[this.tokenIndex];
        },

        match: function (tt, scanOperand, keywordIsName) {
            return this.get(scanOperand, keywordIsName) === tt || this.unget();
        },

        mustMatch: function (tt, keywordIsName) {
            if (!this.match(tt, false, keywordIsName)) {
                throw this.newSyntaxError("Missing " +
                                          definitions.tokens[tt].toLowerCase());
            }
            return this.token;
        },

        peek: function (scanOperand) {
            var tt, next;
            if (this.lookahead) {
                next = this.tokens[(this.tokenIndex + this.lookahead) & 3];
                tt = (this.scanNewlines && next.lineno !== this.lineno)
                     ? NEWLINE
                     : next.type;
            } else {
                tt = this.get(scanOperand);
                this.unget();
            }
            return tt;
        },

        peekOnSameLine: function (scanOperand) {
            this.scanNewlines = true;
            var tt = this.peek(scanOperand);
            this.scanNewlines = false;
            return tt;
        },

        lastBlockComment: function() {
            var length = this.blockComments.length;
            return length ? this.blockComments[length - 1] : null;
        },

        // Eat comments and whitespace.
        skip: function () {
            var input = this.source;
            var start;
            this.blockComments = [];
            for (;;) {
                var ch = input[this.cursor++];
                var next = input[this.cursor];
                // handle \r, \r\n and (always preferable) \n
                if (ch === '\r') {
                    // if the next character is \n, we don't care about this at all
                    if (next === '\n') continue;

                    // otherwise, we want to consider this as a newline
                    ch = '\n';
                }

                if (ch === '\n' && !this.scanNewlines) {
                    this.lineno++;
                } else if (ch === '/' && next === '*') {
                    start = this.cursor - 1;
                    var commentStart = ++this.cursor;
                    for (;;) {
                        ch = input[this.cursor++];
                        if (ch === undefined)
                            throw this.newSyntaxError("Unterminated comment");

                        if (ch === '*') {
                            next = input[this.cursor];
                            if (next === '/') {
                                var commentEnd = this.cursor - 1;
                                this.cursor++;
                                this.comments.push({
                                    start: start,
                                    end: this.cursor
                                });
                                break;
                            }
                        } else if (ch === '\n') {
                            this.lineno++;
                        }
                    }
                    this.blockComments.push(input.substring(commentStart, commentEnd));
                } else if ((ch === '/' && next === '/') ||
                           (Narcissus.options.allowHTMLComments && ch === '<' && next === '!' &&
                            input[this.cursor + 1] === '-' && input[this.cursor + 2] === '-' &&
                            (this.cursor += 2))) {
                    start = this.cursor - 1;
                    this.cursor++;
                    for (;;) {
                        ch = input[this.cursor++];
                        next = input[this.cursor];

                        if (ch === '\r') {
                            // check for \r\n
                            if (next !== '\n') ch = '\n';
                        }

                        if (ch === undefined || ch === '\n') {
                            this.comments.push({
                                start: start,
                                end: this.cursor
                            });
                        }
                        if (ch === undefined)
                            return;

                        if (ch === '\n') {
                            if (this.scanNewlines) {
                                this.cursor--;
                            } else {
                                this.lineno++;
                            }
                            break;
                        }
                    }
                } else if (!(ch in definitions.whitespace)) {
                    this.cursor--;
                    return;
                }
            }
        },

        // Lex the exponential part of a number, if present. Return true iff an
        // exponential part was found.
        lexExponent: function() {
            var input = this.source;
            var next = input[this.cursor];
            if (next === 'e' || next === 'E') {
                this.cursor++;
                ch = input[this.cursor++];
                if (ch === '+' || ch === '-')
                    ch = input[this.cursor++];

                if (ch < '0' || ch > '9')
                    throw this.newSyntaxError("Missing exponent");

                do {
                    ch = input[this.cursor++];
                } while (ch >= '0' && ch <= '9');
                this.cursor--;

                return true;
            }

            return false;
        },

        lexZeroNumber: function (ch) {
            var token = this.token, input = this.source;
            token.type = NUMBER;

            ch = input[this.cursor++];
            if (ch === '.') {
                do {
                    ch = input[this.cursor++];
                } while (ch >= '0' && ch <= '9');
                this.cursor--;

                this.lexExponent();
                token.value = parseFloat(
                                input.substring(token.start, this.cursor));
            } else if (ch === 'x' || ch === 'X') {
                do {
                    ch = input[this.cursor++];
                } while ((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') ||
                         (ch >= 'A' && ch <= 'F'));
                this.cursor--;

                token.value = parseInt(input.substring(token.start, this.cursor));
            } else if (ch >= '0' && ch <= '7') {
                do {
                    ch = input[this.cursor++];
                } while (ch >= '0' && ch <= '7');
                this.cursor--;

                token.value = parseInt(input.substring(token.start, this.cursor));
            } else {
                this.cursor--;
                this.lexExponent();     // 0E1, &c.
                token.value = 0;
            }
        },

        lexNumber: function (ch) {
            var token = this.token, input = this.source;
            token.type = NUMBER;

            var floating = false;
            do {
                ch = input[this.cursor++];
                if (ch === '.' && !floating) {
                    floating = true;
                    ch = input[this.cursor++];
                }
            } while (ch >= '0' && ch <= '9');

            this.cursor--;

            var exponent = this.lexExponent();
            floating = floating || exponent;

            var str = input.substring(token.start, this.cursor);
            token.value = floating ? parseFloat(str) : parseInt(str);
        },

        lexDot: function (ch) {
            var token = this.token, input = this.source;
            var next = input[this.cursor];
            if (next >= '0' && next <= '9') {
                do {
                    ch = input[this.cursor++];
                } while (ch >= '0' && ch <= '9');
                this.cursor--;

                this.lexExponent();

                token.type = NUMBER;
                token.value = parseFloat(
                                input.substring(token.start, this.cursor));
            } else {
                token.type = DOT;
                token.assignOp = null;
                token.value = '.';
            }
        },

        lexString: function (ch) {
            var token = this.token, input = this.source;
            token.type = STRING;

            var hasEscapes = false;
            var delim = ch;
            if (input.length <= this.cursor)
                throw this.newSyntaxError("Unterminated string literal");
            while ((ch = input[this.cursor++]) !== delim) {
                if (this.cursor == input.length)
                    throw this.newSyntaxError("Unterminated string literal");
                if (ch === '\\') {
                    hasEscapes = true;
                    if (++this.cursor == input.length)
                        throw this.newSyntaxError("Unterminated string literal");
                }
            }

            token.value = hasEscapes
                          ? eval(input.substring(token.start, this.cursor))
                          : input.substring(token.start + 1, this.cursor - 1);
        },

        lexRegExp: function (ch) {
            var token = this.token, input = this.source;
            token.type = REGEXP;

            do {
                ch = input[this.cursor++];
                if (ch === '\\') {
                    this.cursor++;
                } else if (ch === '[') {
                    do {
                        if (ch === undefined)
                            throw this.newSyntaxError("Unterminated character class");

                        if (ch === '\\')
                            this.cursor++;

                        ch = input[this.cursor++];
                    } while (ch !== ']');
                } else if (ch === undefined) {
                    throw this.newSyntaxError("Unterminated regex");
                }
            } while (ch !== '/');

            do {
                ch = input[this.cursor++];
            } while (ch >= 'a' && ch <= 'z');

            this.cursor--;

            token.value = eval(input.substring(token.start, this.cursor));
        },

        lexOp: function (ch) {
            var token = this.token, input = this.source;

            // A bit ugly, but it seems wasteful to write a trie lookup routine
            // for only 3 characters...
            var node = opTokens[ch];
            var next = input[this.cursor];
            if (next in node) {
                node = node[next];
                this.cursor++;
                next = input[this.cursor];
                if (next in node) {
                    node = node[next];
                    this.cursor++;
                    next = input[this.cursor];
                }
            }

            var op = node.op;
            if (definitions.assignOps[op] && input[this.cursor] === '=') {
                this.cursor++;
                token.type = ASSIGN;
                token.assignOp = definitions.tokenIds[definitions.opTypeNames[op]];
                op += '=';
            } else {
                token.type = definitions.tokenIds[definitions.opTypeNames[op]];
                token.assignOp = null;
            }

            token.value = op;
        },

        // FIXME: Unicode escape sequences
        lexIdent: function (ch, keywordIsName) {
            var token = this.token;
            var id = ch;

            while ((ch = this.getValidIdentifierChar(false)) !== null) {
                id += ch;
            }

            token.type = IDENTIFIER;
            token.value = id;

            if (keywordIsName)
                return;

            var kw = definitions.keywords[id];
            if (kw && !(kw in this.blackList))
                token.type = kw;
        },

        /*
         * Tokenizer.get :: [boolean[, boolean]] -> token type
         *
         * Consume input *only* if there is no lookahead.
         * Dispatch to the appropriate lexing function depending on the input.
         */
        get: function (scanOperand, keywordIsName) {
            var token;
            while (this.lookahead) {
                --this.lookahead;
                this.tokenIndex = (this.tokenIndex + 1) & 3;
                token = this.tokens[this.tokenIndex];
                if (token.type !== NEWLINE || this.scanNewlines)
                    return token.type;
            }

            this.skip();

            this.tokenIndex = (this.tokenIndex + 1) & 3;
            token = this.tokens[this.tokenIndex];
            if (!token)
                this.tokens[this.tokenIndex] = token = {};

            var input = this.source;
            if (this.cursor >= input.length)
                return token.type = END;

            token.start = this.cursor;
            token.lineno = this.lineno;

            var ich = this.getValidIdentifierChar(true);
            var ch = (ich === null) ? input[this.cursor++] : null;
            if (ich !== null) {
                this.lexIdent(ich, keywordIsName);
            } else if (scanOperand && ch === '/') {
                this.lexRegExp(ch);
            } else if (ch in opTokens) {
                this.lexOp(ch);
            } else if (ch === '.') {
                this.lexDot(ch);
            } else if (ch >= '1' && ch <= '9') {
                this.lexNumber(ch);
            } else if (ch === '0') {
                this.lexZeroNumber(ch);
            } else if (ch === '"' || ch === "'") {
                this.lexString(ch);
            } else if (this.scanNewlines && (ch === '\n' || ch === '\r')) {
                // if this was a \r, look for \r\n
                if (ch === '\r' && input[this.cursor] === '\n') this.cursor++;
                token.type = NEWLINE;
                token.value = '\n';
                this.lineno++;
            } else {
                throw this.newSyntaxError("Illegal token");
            }

            token.end = this.cursor;
            return token.type;
        },

        /*
         * Tokenizer.unget :: void -> undefined
         *
         * Match depends on unget returning undefined.
         */
        unget: function () {
            if (++this.lookahead === 4) throw "PANIC: too much lookahead!";
            this.tokenIndex = (this.tokenIndex - 1) & 3;
        },

        newSyntaxError: function (m) {
            m = (this.filename ? this.filename + ":" : "") + this.lineno + ": " + m;
            var e = new /*Syntax*/Error(m, this.filename, this.lineno);
            e.source = this.source;
            e.cursor = this.lookahead
                       ? this.tokens[(this.tokenIndex + this.lookahead) & 3].start
                       : this.cursor;
            // filename and lineno aren't standard properties of SyntaxError;
            // put them in their own field for access by non-Moz JS runtimes
            e.filename = this.filename;
            e.lineno = this.lineno;
            return e;
        },


        /* Gets a single valid identifier char from the input stream, or null
         * if there is none.
         */
        getValidIdentifierChar: function(first) {
            var input = this.source;
            if (this.cursor >= input.length) return null;
            var ch = input[this.cursor];

            // first check for \u escapes
            if (ch === '\\' && input[this.cursor+1] === 'u') {
                // get the character value
                try {
                    ch = String.fromCharCode(parseInt(
                        input.substring(this.cursor + 2, this.cursor + 6),
                        16));
                } catch (ex) {
                    return null;
                }
                this.cursor += 5;
            }

            var valid = isValidIdentifierChar(ch, first);
            if (valid) this.cursor++;
            return (valid ? ch : null);
        },
    };


    return {
        isIdentifier: isIdentifier,
        Tokenizer: Tokenizer
    };

}());

    return Narcissus.lexer;
});

/* -*- Mode: JS; tab-width: 4; indent-tabs-mode: nil; -*-
 * vim: set sw=4 ts=4 et tw=78:
 * ***** BEGIN LICENSE BLOCK *****
 *
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the Narcissus JavaScript engine.
 *
 * The Initial Developer of the Original Code is
 * Brendan Eich <brendan@mozilla.org>.
 * Portions created by the Initial Developer are Copyright (C) 2004
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Tom Austin <taustin@ucsc.edu>
 *   Brendan Eich <brendan@mozilla.org>
 *   Shu-Yu Guo <shu@rfrn.org>
 *   Dave Herman <dherman@mozilla.com>
 *   Dimitris Vardoulakis <dimvar@ccs.neu.edu>
 *   Patrick Walton <pcwalton@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Narcissus - JS implemented in JS.
 *
 * Parser.
 */


define('narcissus/lib/jsparse',['./n', './jsdefs', './jslex'], function(Narcissus, definitions, lexer){

Narcissus.parser = (function() {

    var lexer = Narcissus.lexer;
    var definitions = Narcissus.definitions;

    var Dict = definitions.Dict;
    var Stack = definitions.Stack;

    // Set constants in the local scope.
    var END = 0, NEWLINE = 1, SEMICOLON = 2, COMMA = 3, ASSIGN = 4, HOOK = 5, COLON = 6, CONDITIONAL = 7, OR = 8, AND = 9, BITWISE_OR = 10, BITWISE_XOR = 11, BITWISE_AND = 12, EQ = 13, NE = 14, STRICT_EQ = 15, STRICT_NE = 16, LT = 17, LE = 18, GE = 19, GT = 20, LSH = 21, RSH = 22, URSH = 23, PLUS = 24, MINUS = 25, MUL = 26, DIV = 27, MOD = 28, NOT = 29, BITWISE_NOT = 30, UNARY_PLUS = 31, UNARY_MINUS = 32, INCREMENT = 33, DECREMENT = 34, DOT = 35, LEFT_BRACKET = 36, RIGHT_BRACKET = 37, LEFT_CURLY = 38, RIGHT_CURLY = 39, LEFT_PAREN = 40, RIGHT_PAREN = 41, SCRIPT = 42, BLOCK = 43, LABEL = 44, FOR_IN = 45, CALL = 46, NEW_WITH_ARGS = 47, INDEX = 48, ARRAY_INIT = 49, OBJECT_INIT = 50, PROPERTY_INIT = 51, GETTER = 52, SETTER = 53, GROUP = 54, LIST = 55, LET_BLOCK = 56, ARRAY_COMP = 57, GENERATOR = 58, COMP_TAIL = 59, IDENTIFIER = 60, NUMBER = 61, STRING = 62, REGEXP = 63, BREAK = 64, CASE = 65, CATCH = 66, CONST = 67, CONTINUE = 68, DEBUGGER = 69, DEFAULT = 70, DELETE = 71, DO = 72, ELSE = 73, EXPORT = 74, FALSE = 75, FINALLY = 76, FOR = 77, FUNCTION = 78, IF = 79, IMPORT = 80, IN = 81, INSTANCEOF = 82, LET = 83, MODULE = 84, NEW = 85, NULL = 86, RETURN = 87, SWITCH = 88, THIS = 89, THROW = 90, TRUE = 91, TRY = 92, TYPEOF = 93, VAR = 94, VOID = 95, YIELD = 96, WHILE = 97, WITH = 98;

    // Banned statement types by language version.
    var blackLists = { 160: {}, 185: {}, harmony: {} };
    blackLists[160][IMPORT] = true;
    blackLists[160][EXPORT] = true;
    blackLists[160][LET] = true;
    blackLists[160][MODULE] = true;
    blackLists[160][YIELD] = true;
    blackLists[185][IMPORT] = true;
    blackLists[185][EXPORT] = true;
    blackLists[185][MODULE] = true;
    blackLists.harmony[WITH] = true;

    /*
     * pushDestructuringVarDecls :: (node, hoisting node) -> void
     *
     * Recursively add all destructured declarations to varDecls.
     */
    function pushDestructuringVarDecls(n, s) {
        for (var i in n) {
            var sub = n[i];
            if (sub.type === IDENTIFIER) {
                s.varDecls.push(sub);
            } else {
                pushDestructuringVarDecls(sub, s);
            }
        }
    }

    function StaticContext(parentScript, parentBlock, inModule, inFunction) {
        this.parentScript = parentScript;
        this.parentBlock = parentBlock || parentScript;
        this.inModule = inModule || false;
        this.inFunction = inFunction || false;
        this.inForLoopInit = false;
        this.topLevel = true;
        this.allLabels = new Stack();
        this.currentLabels = new Stack();
        this.labeledTargets = new Stack();
        this.defaultLoopTarget = null;
        this.defaultTarget = null;
        this.blackList = blackLists[Narcissus.options.version];
        Narcissus.options.ecma3OnlyMode && (this.ecma3OnlyMode = true);
        Narcissus.options.parenFreeMode && (this.parenFreeMode = true);
    }

    StaticContext.prototype = {
        ecma3OnlyMode: false,
        parenFreeMode: false,
        // non-destructive update via prototype extension
        update: function(ext) {
            var desc = {};
            for (var key in ext) {
                desc[key] = {
                    value: ext[key],
                    writable: true,
                    enumerable: true,
                    configurable: true
                }
            }
            return Object.create(this, desc);
        },
        pushLabel: function(label) {
            return this.update({ currentLabels: this.currentLabels.push(label),
                                 allLabels: this.allLabels.push(label) });
        },
        pushTarget: function(target) {
            var isDefaultLoopTarget = target.isLoop;
            var isDefaultTarget = isDefaultLoopTarget || target.type === SWITCH;

            if (this.currentLabels.isEmpty()) {
                if (isDefaultLoopTarget) this.update({ defaultLoopTarget: target });
                if (isDefaultTarget) this.update({ defaultTarget: target });
                return this;
            }

            target.labels = new Dict();
            this.currentLabels.forEach(function(label) {
                target.labels.set(label, true);
            });
            return this.update({ currentLabels: new Stack(),
                                 labeledTargets: this.labeledTargets.push(target),
                                 defaultLoopTarget: isDefaultLoopTarget
                                                    ? target
                                                    : this.defaultLoopTarget,
                                 defaultTarget: isDefaultTarget
                                                ? target
                                                : this.defaultTarget });
        },
        nest: function() {
            return this.topLevel ? this.update({ topLevel: false }) : this;
        },
        allow: function(type) {
            switch (type) {
              case EXPORT:
                if (!this.inModule || this.inFunction || !this.topLevel)
                    return false;
                // FALL THROUGH

              case IMPORT:
                return !this.inFunction && this.topLevel;

              case MODULE:
                return !this.inFunction && this.topLevel;

              default:
                return true;
            }
        }
    };

    /*
     * Script :: (tokenizer, boolean, boolean) -> node
     *
     * Parses the toplevel and module/function bodies.
     */
    function Script(t, inModule, inFunction) {
        var n = new Node(t, scriptInit());
        Statements(t, new StaticContext(n, n, inModule, inFunction), n);
        return n;
    }

    /*
     * Node :: (tokenizer, optional init object) -> node
     */
    function Node(t, init) {
        var token = t.token;
        if (token) {
            // If init.type exists it will override token.type.
            this.type = token.type;
            this.value = token.value;
            this.lineno = token.lineno;

            // Start and end are file positions for error handling.
            this.start = token.start;
            this.end = token.end;
        } else {
            this.lineno = t.lineno;
        }

        // Node uses a tokenizer for debugging (getSource, filename getter).
        this.tokenizer = t;
        this.children = [];

        for (var prop in init)
            this[prop] = init[prop];
    }

    /*
     * SyntheticNode :: (tokenizer, optional init object) -> node
     */
    function SyntheticNode(t, init) {
        // print("SYNTHETIC NODE");
        // if (init.type === COMMA) {
        //     print("SYNTHETIC COMMA");
        //     print(init);
        // }
        this.tokenizer = t;
        this.children = [];
        for (var prop in init)
            this[prop] = init[prop];
        this.synthetic = true;
    }

    var Np = Node.prototype = SyntheticNode.prototype = {};
    Np.constructor = Node;

    var TO_SOURCE_SKIP = {
        type: true,
        value: true,
        lineno: true,
        start: true,
        end: true,
        tokenizer: true,
        assignOp: true
    };
    function unevalableConst(code) {
        var token = definitions.tokens[code];
        var constName = definitions.opTypeNames.hasOwnProperty(token)
                      ? definitions.opTypeNames[token]
                      : token in definitions.keywords
                      ? token.toUpperCase()
                      : token;
        return { toSource: function() { return constName } };
    }
    Np.toSource = function toSource() {
        var mock = {};
        var self = this;
        mock.type = unevalableConst(this.type);
        // avoid infinite recursion in case of back-links
        if (this.generatingSource)
            return mock.toSource();
        this.generatingSource = true;
        if ("value" in this)
            mock.value = this.value;
        if ("lineno" in this)
            mock.lineno = this.lineno;
        if ("start" in this)
            mock.start = this.start;
        if ("end" in this)
            mock.end = this.end;
        if (this.assignOp)
            mock.assignOp = unevalableConst(this.assignOp);
        for (var key in this) {
            if (this.hasOwnProperty(key) && !(key in TO_SOURCE_SKIP))
                mock[key] = this[key];
        }
        try {
            return mock.toSource();
        } finally {
            delete this.generatingSource;
        }
    };

    // Always use push to add operands to an expression, to update start and end.
    Np.push = function (kid) {
        // kid can be null e.g. [1, , 2].
        if (kid !== null) {
            if (this.start === undefined || kid.start < this.start)
                this.start = kid.start;
            if (this.end === undefined || this.end < kid.end)
                this.end = kid.end;
        }
        return this.children.push(kid);
    }

    Node.indentLevel = 0;

    function tokenString(tt) {
        var t = definitions.tokens[tt];
        return /^\W/.test(t) ? definitions.opTypeNames[t] : t.toUpperCase();
    }

    Np.toString = function () {
        var a = [];
        for (var i in this) {
            if (this.hasOwnProperty(i) && i !== 'type' && i !== 'target')
                a.push({id: i, value: this[i]});
        }
        a.sort(function (a,b) { return (a.id < b.id) ? -1 : 1; });
        var INDENTATION = "    ";
        var n = ++Node.indentLevel;
        var s = "{\n" + INDENTATION.repeat(n) + "type: " + tokenString(this.type);
        for (i = 0; i < a.length; i++)
            s += ",\n" + INDENTATION.repeat(n) + a[i].id + ": " + a[i].value;
        n = --Node.indentLevel;
        s += "\n" + INDENTATION.repeat(n) + "}";
        return s;
    }

    Np.getSource = function () {
        return this.tokenizer.source.slice(this.start, this.end);
    };

    Np.synth = function(init) {
        var node = new SyntheticNode(this.tokenizer, init);
        node.filename = this.filename;
        node.lineno = this.lineno;
        node.start = this.start;
        node.end = this.end;
        return node;
    };

    /*
     * Helper init objects for common nodes.
     */

    var LOOP_INIT = { isLoop: true };

    function blockInit() {
        return { type: BLOCK, varDecls: [] };
    }

    function scriptInit() {
        return { type: SCRIPT,
                 funDecls: [],
                 varDecls: [],
                 modDefns: new Dict(),
                 modAssns: new Dict(),
                 modDecls: new Dict(),
                 modLoads: new Dict(),
                 impDecls: [],
                 expDecls: [],
                 exports: new Dict(),
                 hasEmptyReturn: false,
                 hasReturnWithValue: false,
                 hasYield: false };
    }

    definitions.defineGetter(Np, "filename",
                             function() {
                                 return this.tokenizer.filename;
                             });

    definitions.defineGetter(Np, "length",
                             function() {
                                 throw new Error("Node.prototype.length is gone; " +
                                                 "use n.children.length instead");
                             });

    definitions.defineProperty(String.prototype, "repeat",
                               function(n) {
                                   var s = "", t = this + s;
                                   while (--n >= 0)
                                       s += t;
                                   return s;
                               }, false, false, true);

    function MaybeLeftParen(t, x) {
        if (x.parenFreeMode)
            return t.match(LEFT_PAREN) ? LEFT_PAREN : END;
        return t.mustMatch(LEFT_PAREN).type;
    }

    function MaybeRightParen(t, p) {
        if (p === LEFT_PAREN)
            t.mustMatch(RIGHT_PAREN);
    }

    /*
     * Statements :: (tokenizer, compiler context, node) -> void
     *
     * Parses a sequence of Statements.
     */
    function Statements(t, x, n) {
        try {
            while (!t.done && t.peek(true) !== RIGHT_CURLY)
                n.push(Statement(t, x));
        } catch (e) {
            if (t.done)
                t.unexpectedEOF = true;
            throw e;
        }
    }

    function Block(t, x) {
        t.mustMatch(LEFT_CURLY);
        var n = new Node(t, blockInit());
        Statements(t, x.update({ parentBlock: n }).pushTarget(n), n);
        n.end = t.mustMatch(RIGHT_CURLY).end;
        return n;
    }

    var DECLARED_FORM = 0, EXPRESSED_FORM = 1, STATEMENT_FORM = 2;

    /*
     * Export :: (binding node, boolean) -> Export
     *
     * Static semantic representation of a module export.
     */
    function Export(node, isDefinition) {
        this.node = node;                 // the AST node declaring this individual export
        this.isDefinition = isDefinition; // is the node an 'export'-annotated definition?
        this.resolved = null;             // resolved pointer to the target of this export
    }

    /*
     * registerExport :: (Dict, EXPORT node) -> void
     */
    function registerExport(exports, decl) {
        function register(name, exp) {
            if (exports.has(name))
                throw new /*Syntax*/Error("multiple exports of " + name);
            exports.set(name, exp);
        }

        switch (decl.type) {
          case MODULE:
          case FUNCTION:
            register(decl.name, new Export(decl, true));
            break;

          case VAR:
            for (var i = 0; i < decl.children.length; i++)
                register(decl.children[i].name, new Export(decl.children[i], true));
            break;

          case LET:
          case CONST:
            throw new Error("NYI: " + definitions.tokens[decl.type]);

          case EXPORT:
            for (var i = 0; i < decl.pathList.length; i++) {
                var path = decl.pathList[i];
                switch (path.type) {
                  case OBJECT_INIT:
                    for (var j = 0; j < path.children.length; j++) {
                        // init :: IDENTIFIER | PROPERTY_INIT
                        var init = path.children[j];
                        if (init.type === IDENTIFIER)
                            register(init.value, new Export(init, false));
                        else
                            register(init.children[0].value, new Export(init.children[1], false));
                    }
                    break;

                  case DOT:
                    register(path.children[1].value, new Export(path, false));
                    break;

                  case IDENTIFIER:
                    register(path.value, new Export(path, false));
                    break;

                  default:
                    throw new Error("unexpected export path: " + definitions.tokens[path.type]);
                }
            }
            break;

          default:
            throw new Error("unexpected export decl: " + definitions.tokens[exp.type]);
        }
    }

    /*
     * Module :: (node) -> Module
     *
     * Static semantic representation of a module.
     */
    function Module(node) {
        var exports = node.body.exports;
        var modDefns = node.body.modDefns;

        var exportedModules = new Dict();

        exports.forEach(function(name, exp) {
            var node = exp.node;
            if (node.type === MODULE) {
                exportedModules.set(name, node);
            } else if (!exp.isDefinition && node.type === IDENTIFIER && modDefns.has(node.value)) {
                var mod = modDefns.get(node.value);
                exportedModules.set(name, mod);
            }
        });

        this.node = node;
        this.exports = exports;
        this.exportedModules = exportedModules;
    }

    /*
     * Statement :: (tokenizer, compiler context) -> node
     *
     * Parses a Statement.
     */
    function Statement(t, x) {
        var i, label, n, n2, p, c, ss, tt = t.get(true), tt2, x2, x3;

        var comments = t.blockComments;

        if (x.blackList[tt])
            throw t.newSyntaxError(definitions.tokens[tt] + " statements only allowed in Harmony");
        if (!x.allow(tt))
            throw t.newSyntaxError(definitions.tokens[tt] + " statement in illegal context");

        // Cases for statements ending in a right curly return early, avoiding the
        // common semicolon insertion magic after this switch.
        switch (tt) {
          case IMPORT:
            n = new Node(t);
            n.pathList = ImportPathList(t, x);
            x.parentScript.impDecls.push(n);
            break;

          case EXPORT:
            switch (t.peek()) {
              case MODULE:
              case FUNCTION:
              case LET:
              case VAR:
              case CONST:
                n = Statement(t, x);
                n.blockComments = comments;
                n.exported = true;
                x.parentScript.expDecls.push(n);
                registerExport(x.parentScript.exports, n);
                return n;

              default:
                n = new Node(t);
                n.pathList = ExportPathList(t, x);
                break;
            }
            x.parentScript.expDecls.push(n);
            registerExport(x.parentScript.exports, n);
            break;

          case MODULE:
            n = new Node(t);
            n.blockComments = comments;
            t.mustMatch(IDENTIFIER);
            label = t.token.value;

            if (t.match(LEFT_CURLY)) {
                n.name = label;
                n.body = Script(t, true, false);
                n.module = new Module(n);
                t.mustMatch(RIGHT_CURLY);
                x.parentScript.modDefns.set(n.name, n);
                return n;
            }

            t.unget();
            ModuleVariables(t, x, n);
            return n;

          case FUNCTION:
            // DECLARED_FORM extends funDecls of x, STATEMENT_FORM doesn't.
            return FunctionDefinition(t, x, true, x.topLevel ? DECLARED_FORM : STATEMENT_FORM, comments);

          case LEFT_CURLY:
            n = new Node(t, blockInit());
            Statements(t, x.update({ parentBlock: n }).pushTarget(n).nest(), n);
            n.end = t.mustMatch(RIGHT_CURLY).end;
            return n;

          case IF:
            n = new Node(t);
            n.condition = HeadExpression(t, x);
            x2 = x.pushTarget(n).nest();
            n.thenPart = Statement(t, x2);
            n.elsePart = t.match(ELSE, true) ? Statement(t, x2) : null;
            return n;

          case SWITCH:
            // This allows CASEs after a DEFAULT, which is in the standard.
            n = new Node(t, { cases: [], defaultIndex: -1 });
            n.discriminant = HeadExpression(t, x);
            x2 = x.pushTarget(n).nest();
            t.mustMatch(LEFT_CURLY);
            while ((tt = t.get()) !== RIGHT_CURLY) {
                switch (tt) {
                  case DEFAULT:
                    if (n.defaultIndex >= 0)
                        throw t.newSyntaxError("More than one switch default");
                    // FALL THROUGH
                  case CASE:
                    n2 = new Node(t);
                    if (tt === DEFAULT)
                        n.defaultIndex = n.cases.length;
                    else
                        n2.caseLabel = Expression(t, x2, COLON);
                    break;

                  default:
                    throw t.newSyntaxError("Invalid switch case");
                }
                t.mustMatch(COLON);
                n2.statements = new Node(t, blockInit());
                while ((tt=t.peek(true)) !== CASE && tt !== DEFAULT &&
                        tt !== RIGHT_CURLY)
                    n2.statements.push(Statement(t, x2));
                n2.statements.start = (n2.statements.children.length === 0 ?
                                       n2.statements.start + 1 :
                                       n2.statements.children[0].start);
                n.cases.push(n2);
            }
            n.end = t.token.end;
            return n;

          case FOR:
            n = new Node(t, LOOP_INIT);
            n.blockComments = comments;
            if (t.match(IDENTIFIER)) {
                if (t.token.value === "each")
                    n.isEach = true;
                else
                    t.unget();
            }
            if (!x.parenFreeMode)
                t.mustMatch(LEFT_PAREN);
            x2 = x.pushTarget(n).nest();
            x3 = x.update({ inForLoopInit: true });
            n2 = null;
            if ((tt = t.peek(true)) !== SEMICOLON) {
                if (tt === VAR || tt === CONST) {
                    t.get();
                    n2 = Variables(t, x3);
                } else if (tt === LET) {
                    t.get();
                    if (t.peek() === LEFT_PAREN) {
                        n2 = LetBlock(t, x3, false);
                    } else {
                        // Let in for head, we need to add an implicit block
                        // around the rest of the for.
                        x3.parentBlock = n;
                        n.varDecls = [];
                        n2 = Variables(t, x3);
                    }
                } else {
                    n2 = Expression(t, x3);
                }
            }
            if (n2 && t.match(IN)) {
                n.type = FOR_IN;
                n.object = Expression(t, x3);
                if (n2.type === VAR || n2.type === LET) {
                    c = n2.children;

                    // Destructuring turns one decl into multiples, so either
                    // there must be only one destructuring or only one
                    // decl.
                    if (c.length !== 1 && n2.destructurings.length !== 1) {
                        throw new /*Syntax*/Error("Invalid for..in left-hand side",
                                              t.filename, n2.lineno);
                    }
                    if (n2.destructurings.length > 0) {
                        n.iterator = n2.destructurings[0];
                    } else {
                        n.iterator = c[0];
                    }
                    n._iterator = n.varDecl = n2;
                } else {
                    if (n2.type === ARRAY_INIT || n2.type === OBJECT_INIT) {
                        n2.destructuredNames = checkDestructuring(t, x3, n2);
                    }
                    n._iterator = n.iterator = n2;
                }
            } else {
                x3.inForLoopInit = false;
                n.setup = n2;
                t.mustMatch(SEMICOLON);
                if (n.isEach)
                    throw t.newSyntaxError("Invalid for each..in loop");
                n.condition = (t.peek(true) === SEMICOLON)
                              ? null
                              : Expression(t, x3);
                t.mustMatch(SEMICOLON);
                tt2 = t.peek(true);
                n.update = (x.parenFreeMode
                            ? tt2 === LEFT_CURLY || definitions.isStatementStartCode[tt2]
                            : tt2 === RIGHT_PAREN)
                           ? null
                           : Expression(t, x3);
            }
            if (!x.parenFreeMode)
                t.mustMatch(RIGHT_PAREN);
            n.body = Statement(t, x2);
            return n;

          case WHILE:
            n = new Node(t, { isLoop: true });
            n.blockComments = comments;
            n.condition = HeadExpression(t, x);
            n.body = Statement(t, x.pushTarget(n).nest());
            return n;

          case DO:
            n = new Node(t, { isLoop: true });
            n.blockComments = comments;
            n.body = Statement(t, x.pushTarget(n).nest());
            t.mustMatch(WHILE);
            n.condition = HeadExpression(t, x);
            if (!x.ecmaStrictMode) {
                // <script language="JavaScript"> (without version hints) may need
                // automatic semicolon insertion without a newline after do-while.
                // See http://bugzilla.mozilla.org/show_bug.cgi?id=238945.
                t.match(SEMICOLON);
                return n;
            }
            break;

          case BREAK:
          case CONTINUE:
            n = new Node(t);
            n.blockComments = comments;

            // handle the |foo: break foo;| corner case
            x2 = x.pushTarget(n);

            if (t.peekOnSameLine() === IDENTIFIER) {
                t.get();
                n.label = t.token.value;
                n.end = t.token.end;
            }

            if (n.label) {
                n.target = x2.labeledTargets.find(function(target) {
                    return target.labels.has(n.label)
                });
            } else if (tt === CONTINUE) {
                n.target = x2.defaultLoopTarget;
            } else {
                n.target = x2.defaultTarget;
            }

            if (!n.target)
                throw t.newSyntaxError("Invalid " + ((tt === BREAK) ? "break" : "continue"));
            if (!n.target.isLoop && tt === CONTINUE)
                throw t.newSyntaxError("Invalid continue");

            break;

          case TRY:
            n = new Node(t, { catchClauses: [] });
            n.blockComments = comments;
            n.tryBlock = Block(t, x);
            while (t.match(CATCH)) {
                n2 = new Node(t);
                p = MaybeLeftParen(t, x);
                switch (t.get()) {
                  case LEFT_BRACKET:
                  case LEFT_CURLY:
                    // Destructured catch identifiers.
                    t.unget();
                    n2.varName = DestructuringExpression(t, x, true);
                    break;
                  case IDENTIFIER:
                    n2._name = new Node(t);
                    n2.varName = t.token.value;
                    break;
                  default:
                    throw t.newSyntaxError("missing identifier in catch");
                    break;
                }
                if (t.match(IF)) {
                    if (x.ecma3OnlyMode)
                        throw t.newSyntaxError("Illegal catch guard");
                    if (n.catchClauses.length && !n.catchClauses.top().guard)
                        throw t.newSyntaxError("Guarded catch after unguarded");
                    n2.guard = Expression(t, x);
                }
                MaybeRightParen(t, p);
                n2.block = Block(t, x);
                n.catchClauses.push(n2);
            }
            if (t.match(FINALLY))
                n.finallyBlock = Block(t, x);
            if (!n.catchClauses.length && !n.finallyBlock)
                throw t.newSyntaxError("Invalid try statement");
            return n;

          case CATCH:
          case FINALLY:
            throw t.newSyntaxError(definitions.tokens[tt] + " without preceding try");

          case THROW:
            n = new Node(t);
            n.exception = Expression(t, x);
            break;

          case RETURN:
            n = ReturnOrYield(t, x);
            break;

          case WITH:
            n = new Node(t);
            n.blockComments = comments;
            n.object = HeadExpression(t, x);
            n.body = Statement(t, x.pushTarget(n).nest());
            return n;

          case VAR:
          case CONST:
            n = Variables(t, x);
            break;

          case LET:
            if (t.peek() === LEFT_PAREN) {
                n = LetBlock(t, x, true);
                return n;
            }
            n = Variables(t, x);
            break;

          case DEBUGGER:
            n = new Node(t);
            break;

          case NEWLINE:
          case SEMICOLON:
            n = new Node(t, { type: SEMICOLON });
            n.blockComments = comments;
            n.expression = null;
            return n;

          default:
            if (tt === IDENTIFIER) {
                tt = t.peek();
                // Labeled statement.
                if (tt === COLON) {
                    label = t.token.value;
                    if (x.allLabels.has(label))
                        throw t.newSyntaxError("Duplicate label");
                    n = new Node(t, { type: LABEL, label: label, _label: new Node(t) });
                    t.get();
                    n.blockComments = comments;
                    n.statement = Statement(t, x.pushLabel(label).nest());
                    n.target = (n.statement.type === LABEL) ? n.statement.target : n.statement;
                    return n;
                }
            }

            // Expression statement.
            // We unget the current token to parse the expression as a whole.
            n = new Node(t, { type: SEMICOLON });
            t.unget();
            n.blockComments = comments;
            n.expression = Expression(t, x);
            MagicalSemicolon(t);
            n.end = (t.token.type === SEMICOLON ? t.token.end : n.expression.end);
            return (t.token.type === SEMICOLON ? n : n.expression);
        }

        n.blockComments = comments;
        if (MagicalSemicolon(t)) {
            //perhaps VAR @; instead of VAR @ < SEMICOLON @;
            //n.end = t.token.end;

            n2 = new Node(t, { type: SEMICOLON });
            n2.expression = n;
            return n2;
        }
        return n;
    }

    /*
     * MagicalSemicolon :: (tokenizer) -> void
     */
    function MagicalSemicolon(t) {
        var tt;
        if (t.lineno === t.token.lineno) {
            tt = t.peekOnSameLine();
            if (tt !== END && tt !== NEWLINE && tt !== SEMICOLON && tt !== RIGHT_CURLY)
                throw t.newSyntaxError("missing ; before statement");
        }
        return t.match(SEMICOLON);
    }

    /*
     * ReturnOrYield :: (tokenizer, compiler context) -> (RETURN | YIELD) node
     */
    function ReturnOrYield(t, x) {
        var n, b, tt = t.token.type, tt2;

        var parentScript = x.parentScript;

        if (tt === RETURN) {
            if (!x.inFunction)
                throw t.newSyntaxError("Return not in function");
        } else /* if (tt === YIELD) */ {
            if (!x.inFunction)
                throw t.newSyntaxError("Yield not in function");
            parentScript.hasYield = true;
        }
        n = new Node(t, { value: undefined });

        tt2 = (tt === RETURN) ? t.peekOnSameLine(true) : t.peek(true);
        if (tt2 !== END && tt2 !== NEWLINE &&
            tt2 !== SEMICOLON && tt2 !== RIGHT_CURLY
            && (tt !== YIELD ||
                (tt2 !== tt && tt2 !== RIGHT_BRACKET && tt2 !== RIGHT_PAREN &&
                 tt2 !== COLON && tt2 !== COMMA))) {
            if (tt === RETURN) {
                n.value = Expression(t, x);
                parentScript.hasReturnWithValue = true;
            } else {
                n.value = AssignExpression(t, x);
            }
        } else if (tt === RETURN) {
            parentScript.hasEmptyReturn = true;
        }

        return n;
    }

    /*
     * ModuleExpression :: (tokenizer, compiler context) -> (STRING | IDENTIFIER | DOT) node
     */
    function ModuleExpression(t, x) {
        return t.match(STRING) ? new Node(t) : QualifiedPath(t, x);
    }

    /*
     * ImportPathList :: (tokenizer, compiler context) -> Array[DOT node]
     */
    function ImportPathList(t, x) {
        var a = [];
        do {
            a.push(ImportPath(t, x));
        } while (t.match(COMMA));
        return a;
    }

    /*
     * ImportPath :: (tokenizer, compiler context) -> DOT node
     */
    function ImportPath(t, x) {
        var n = QualifiedPath(t, x);
        if (!t.match(DOT)) {
            if (n.type === IDENTIFIER)
                throw t.newSyntaxError("cannot import local variable");
            return n;
        }

        var n2 = new Node(t);
        n2.push(n);
        n2.push(ImportSpecifierSet(t, x));
        return n2;
    }

    /*
     * ExplicitSpecifierSet :: (tokenizer, compiler context, (tokenizer, compiler context) -> node)
     *                      -> OBJECT_INIT node
     */
    function ExplicitSpecifierSet(t, x, SpecifierRHS) {
        var n, n2, id, tt;

        n = new Node(t, { type: OBJECT_INIT });
        t.mustMatch(LEFT_CURLY);

        if (!t.match(RIGHT_CURLY)) {
            do {
                id = Identifier(t, x);
                if (t.match(COLON)) {
                    n2 = new Node(t, { type: PROPERTY_INIT });
                    n2.push(id);
                    n2.push(SpecifierRHS(t, x));
                    n.push(n2);
                } else {
                    n.push(id);
                }
            } while (!t.match(RIGHT_CURLY) && t.mustMatch(COMMA));
        }

        return n;
    }

    /*
     * ImportSpecifierSet :: (tokenizer, compiler context) -> (IDENTIFIER | OBJECT_INIT) node
     */
    function ImportSpecifierSet(t, x) {
        return t.match(MUL)
             ? new Node(t, { type: IDENTIFIER, name: "*" })
             : ExplicitSpecifierSet(t, x, Identifier);
    }

    /*
     * Identifier :: (tokenizer, compiler context) -> IDENTIFIER node
     */
    function Identifier(t, x) {
        t.mustMatch(IDENTIFIER);
        return new Node(t, { type: IDENTIFIER });
    }

    /*
     * IdentifierName :: (tokenizer) -> IDENTIFIER node
     */
    function IdentifierName(t) {
        t.mustMatch(IDENTIFIER, true);
        return new Node(t, { type: IDENTIFIER });
    }

    /*
     * QualifiedPath :: (tokenizer, compiler context) -> (IDENTIFIER | DOT) node
     */
    function QualifiedPath(t, x) {
        var n, n2;

        n = Identifier(t, x);

        while (t.match(DOT)) {
            if (t.peek() !== IDENTIFIER) {
                // Unget the '.' token, which isn't part of the QualifiedPath.
                t.unget();
                break;
            }
            n2 = new Node(t);
            n2.push(n);
            n2.push(Identifier(t, x));
            n = n2;
        }

        return n;
    }

    /*
     * ExportPath :: (tokenizer, compiler context) -> (IDENTIFIER | DOT | OBJECT_INIT) node
     */
    function ExportPath(t, x) {
        if (t.peek() === LEFT_CURLY)
            return ExplicitSpecifierSet(t, x, QualifiedPath);
        return QualifiedPath(t, x);
    }

    /*
     * ExportPathList :: (tokenizer, compiler context)
     *                -> Array[(IDENTIFIER | DOT | OBJECT_INIT) node]
     */
    function ExportPathList(t, x) {
        var a = [];
        do {
            a.push(ExportPath(t, x));
        } while (t.match(COMMA));
        return a;
    }

    /*
     * FunctionDefinition :: (tokenizer, compiler context, boolean,
     *                        DECLARED_FORM or EXPRESSED_FORM or STATEMENT_FORM,
     *                        [string] or null or undefined)
     *                    -> node
     */
    function FunctionDefinition(t, x, requireName, functionForm, comments) {
        var tt;
        var f = new Node(t, { params: [], _params: [], paramComments: [] });
        if (typeof comments === "undefined")
            comments = null;
        f.blockComments = comments;
        if (f.type !== FUNCTION)
            f.type = (f.value === "get") ? GETTER : SETTER;
        if (t.match(MUL))
            f.isExplicitGenerator = true;
        if (t.match(IDENTIFIER, false, true)) {
            f.name = t.token.value;
            f._name = new Node(t);
        }
        else if (requireName)
            throw t.newSyntaxError("missing function identifier");

        var inModule = x ? x.inModule : false;
        var x2 = new StaticContext(null, null, inModule, true);

        t.mustMatch(LEFT_PAREN);
        if (!t.match(RIGHT_PAREN)) {
            do {
                tt = t.get();
                f.paramComments.push(t.lastBlockComment());
                switch (tt) {
                  case LEFT_BRACKET:
                  case LEFT_CURLY:
                    // Destructured formal parameters.
                    t.unget();
                    f.params.push(DestructuringExpression(t, x2));
                    break;
                  case IDENTIFIER:
                    f.params.push(t.token.value);
                    f._params.push(new Node(t));
                    break;
                  default:
                    throw t.newSyntaxError("missing formal parameter");
                    break;
                }
            } while (t.match(COMMA));
            t.mustMatch(RIGHT_PAREN);
        }

        // Do we have an expression closure or a normal body?
        tt = t.get(true);
        if (tt !== LEFT_CURLY)
            t.unget();

        if (tt !== LEFT_CURLY) {
            f.body = AssignExpression(t, x2);
        } else {
            f.body = Script(t, inModule, true);
        }

        if (tt === LEFT_CURLY)
            f.body.end = t.mustMatch(RIGHT_CURLY).end;

        f.end = t.token.end;
        f.functionForm = functionForm;
        if (functionForm === DECLARED_FORM)
            x.parentScript.funDecls.push(f);

        if (Narcissus.options.version === "harmony" && !f.isExplicitGenerator && f.body.hasYield)
            throw t.newSyntaxError("yield in non-generator function");

        if (f.isExplicitGenerator || f.body.hasYield)
            f.body = new Node(t, { type: GENERATOR, body: f.body });

        return f;
    }

    /*
     * ModuleVariables :: (tokenizer, compiler context, MODULE node) -> void
     *
     * Parses a comma-separated list of module declarations (and maybe
     * initializations).
     */
    function ModuleVariables(t, x, n) {
        var n1, n2;
        do {
            n1 = Identifier(t, x);
            if (t.match(ASSIGN)) {
                n2 = ModuleExpression(t, x);
                n1.initializer = n2;
                if (n2.type === STRING)
                    x.parentScript.modLoads.set(n1.value, n2.value);
                else
                    x.parentScript.modAssns.set(n1.value, n1);
            }
            n.push(n1);
        } while (t.match(COMMA));
    }

    /*
     * Variables :: (tokenizer, compiler context) -> node
     *
     * Parses a comma-separated list of var declarations (and maybe
     * initializations).
     */
    function Variables(t, x, letBlock) {
        var n, n2, ss, i, s, tt;

        tt = t.token.type;
        switch (tt) {
          case VAR:
          case CONST:
            s = x.parentScript;
            break;
          case LET:
            s = x.parentBlock;
            break;
          case LEFT_PAREN:
            tt = LET;
            s = letBlock;
            t.get(); // skip paren
            break;
        }

        n = new Node(t, { type: tt, destructurings: [] });
        if (tt == LET) {
            t.unget(); // restore paren
        }

        do {
            tt = t.get();
            if (tt === LEFT_BRACKET || tt === LEFT_CURLY) {
                // Need to unget to parse the full destructured expression.
                t.unget();

                var dexp = DestructuringExpression(t, x, true);

                n2 = new Node(t, { type: IDENTIFIER,
                                   name: dexp,
                                   readOnly: n.type === CONST });
                n.push(n2);
                pushDestructuringVarDecls(n2.name.destructuredNames, s);
                n.destructurings.push({ exp: dexp, decl: n2 });

                if (x.inForLoopInit && t.peek() === IN) {
                    continue;
                }

                t.mustMatch(ASSIGN);
                if (t.token.assignOp)
                    throw t.newSyntaxError("Invalid variable initialization");

                n2.blockComment = t.lastBlockComment();
                n2.initializer = AssignExpression(t, x);

                continue;
            }

            if (tt !== IDENTIFIER)
                throw t.newSyntaxError("missing variable name");

            // removed .initializer fields in var, const, let declarations
            // new form for VAR with initializer is using ASSIGN
            // example for `var x = 3`:
            // VAR: var @ <base>
            //   ASSIGN: @ = @ <base.children[0]>
            //     IDENTIFIER: x <base.children[0]>
            //     NUMBER: 1 <base.children[1]>
            //
            // also removed .name (duplicate of value)
            // and .readOnly (given from VAR or CONST)
            var comment;
            if (t.peek() == ASSIGN) {
                comment = t.lastBlockComment();
                t.unget(); // unget IDENTIFIER
                n2 = AssignExpression(t, x);
                if (n2.assignOp) {
                    throw t.newSyntaxError("Invalid variable initialization");
                }
            }
            else {
                comment = t.lastBlockComment();
                n2 = new Node(t, { type: IDENTIFIER });
            }
            n2.blockComment = comment;
            n.push(n2);
            s.varDecls.push(n2);
        } while (t.match(COMMA));

        return n;
    }

    /*
     * LetBlock :: (tokenizer, compiler context, boolean) -> node
     *
     * Does not handle let inside of for loop init.
     */
    function LetBlock(t, x, isStatement) {
        var n, n2;

        // t.token.type must be LET
        n = new Node(t, { type: LET_BLOCK, varDecls: [] });
        t.mustMatch(LEFT_PAREN);
        n.variables = Variables(t, x, n);
        t.mustMatch(RIGHT_PAREN);

        if (isStatement && t.peek() !== LEFT_CURLY) {
            /*
             * If this is really an expression in let statement guise, then we
             * need to wrap the LET_BLOCK node in a SEMICOLON node so that we pop
             * the return value of the expression.
             */
            n2 = new Node(t, { type: SEMICOLON,
                               expression: n });
            isStatement = false;
        }

        if (isStatement)
            n.block = Block(t, x);
        else
            n.expression = AssignExpression(t, x);

        return n;
    }

    function checkDestructuring(t, x, n, simpleNamesOnly) {
        if (n.type === ARRAY_COMP)
            throw t.newSyntaxError("Invalid array comprehension left-hand side");
        if (n.type !== ARRAY_INIT && n.type !== OBJECT_INIT)
            return;

        var lhss = {};
        var nn, n2, idx, sub, cc, c = n.children;
        for (var i = 0, j = c.length; i < j; i++) {
            if (!(nn = c[i]))
                continue;
            if (nn.type === PROPERTY_INIT) {
                cc = nn.children;
                sub = cc[1];
                idx = cc[0].value;
            } else if (n.type === OBJECT_INIT) {
                // Do we have destructuring shorthand {foo, bar}?
                sub = nn;
                idx = nn.value;
            } else {
                sub = nn;
                idx = i;
            }

            if (sub.type === ARRAY_INIT || sub.type === OBJECT_INIT) {
                lhss[idx] = checkDestructuring(t, x, sub, simpleNamesOnly);
            } else {
                if (simpleNamesOnly && sub.type !== IDENTIFIER) {
                    // In declarations, lhs must be simple names
                    throw t.newSyntaxError("missing name in pattern");
                }

                lhss[idx] = sub;
            }
        }

        return lhss;
    }

    function DestructuringExpression(t, x, simpleNamesOnly) {
        var n = PrimaryExpression(t, x);
        // Keep the list of lefthand sides for varDecls
        n.destructuredNames = checkDestructuring(t, x, n, simpleNamesOnly);
        return n;
    }

    function GeneratorExpression(t, x, e) {
        return new Node(t, { type: GENERATOR,
                             expression: e,
                             tail: ComprehensionTail(t, x) });
    }

    function ComprehensionTail(t, x) {
        var body, n, n2, n3, p;

        // t.token.type must be FOR
        body = new Node(t, { type: COMP_TAIL });

        do {
            // Comprehension tails are always for..in loops.
            n = new Node(t, { type: FOR_IN, isLoop: true });
            if (t.match(IDENTIFIER)) {
                // But sometimes they're for each..in.
                if (t.token.value === "each")
                    n.isEach = true;
                else
                    t.unget();
            }
            p = MaybeLeftParen(t, x);
            switch(t.get()) {
              case LEFT_BRACKET:
              case LEFT_CURLY:
                t.unget();
                // Destructured left side of for in comprehension tails.
                n.iterator = DestructuringExpression(t, x);
                break;

              case IDENTIFIER:
                n.iterator = n3 = new Node(t, { type: IDENTIFIER });
                n3.name = n3.value;
                n.varDecl = n2 = new Node(t, { type: VAR });
                n2.push(n3);
                x.parentScript.varDecls.push(n3);
                // Don't add to varDecls since the semantics of comprehensions is
                // such that the variables are in their own function when
                // desugared.
                break;

              default:
                throw t.newSyntaxError("missing identifier");
            }
            t.mustMatch(IN);
            n.object = Expression(t, x);
            MaybeRightParen(t, p);
            n.end = t.token.end;
            body.push(n);
        } while (t.match(FOR));

        // Optional guard.
        if (t.match(IF))
            body.guard = HeadExpression(t, x);

        body.end = t.token.end;
        return body;
    }

    function HeadExpression(t, x) {
        var p = MaybeLeftParen(t, x);
        var n = ParenExpression(t, x);
        MaybeRightParen(t, p);
        if (p === END && !n.parenthesized) {
            var tt = t.peek();
            if (tt !== LEFT_CURLY && !definitions.isStatementStartCode[tt])
                throw t.newSyntaxError("Unparenthesized head followed by unbraced body");
        }
        return n;
    }

    function ParenExpression(t, x) {
        // Always accept the 'in' operator in a parenthesized expression,
        // where it's unambiguous, even if we might be parsing the init of a
        // for statement.
        var n = Expression(t, x.update({ inForLoopInit: x.inForLoopInit &&
                                                        (t.token.type === LEFT_PAREN) }));

        if (t.match(FOR)) {
            if (n.type === YIELD && !n.parenthesized)
                throw t.newSyntaxError("Yield expression must be parenthesized");
            if (n.type === COMMA && !n.parenthesized)
                throw t.newSyntaxError("Generator expression must be parenthesized");
            n = GeneratorExpression(t, x, n);
        }

        return n;
    }

    /*
     * Expression :: (tokenizer, compiler context) -> node
     *
     * Top-down expression parser matched against SpiderMonkey.
     */
    function Expression(t, x) {
        var n, n2;

        n = AssignExpression(t, x);
        if (t.match(COMMA)) {
            n2 = new Node(t, { type: COMMA });
            n2.push(n);
            n = n2;
            do {
                n2 = n.children[n.children.length-1];
                if (n2.type === YIELD && !n2.parenthesized)
                    throw t.newSyntaxError("Yield expression must be parenthesized");
                n.push(AssignExpression(t, x));
            } while (t.match(COMMA));
        }

        return n;
    }

    function AssignExpression(t, x) {
        var n, lhs;

        // Have to treat yield like an operand because it could be the leftmost
        // operand of the expression.
        if (t.match(YIELD, true))
            return ReturnOrYield(t, x);

        lhs = ConditionalExpression(t, x);

        if (!t.match(ASSIGN)) {
            return lhs;
        }
        n = new Node(t, { type: ASSIGN });

        n.blockComment = t.lastBlockComment();

        var lhs2 = lhs;
        while (lhs2.type === GROUP) {
            lhs2 = lhs2.children[0];
        }

        switch (lhs2.type) {
          case OBJECT_INIT:
          case ARRAY_INIT:
            lhs2.destructuredNames = checkDestructuring(t, x, lhs2);
            // FALL THROUGH
          case IDENTIFIER: case DOT: case INDEX: case CALL:
            break;
          default:
            throw t.newSyntaxError("Bad left-hand side of assignment");
            break;
        }

        n.assignOp = lhs.assignOp = t.token.assignOp;
        n.push(lhs);
        n.push(AssignExpression(t, x));

        return n;
    }

    function ConditionalExpression(t, x) {
        var n, n2;

        n = OrExpression(t, x);
        if (t.match(HOOK)) {
            n2 = n;
            n = new Node(t, { type: HOOK });
            n.push(n2);
            /*
             * Always accept the 'in' operator in the middle clause of a ternary,
             * where it's unambiguous, even if we might be parsing the init of a
             * for statement.
             */
            n.push(AssignExpression(t, x.update({ inForLoopInit: false })));
            if (!t.match(COLON))
                throw t.newSyntaxError("missing : after ?");
            n.push(AssignExpression(t, x));
        }

        return n;
    }

    function OrExpression(t, x) {
        var n, n2;

        n = AndExpression(t, x);
        while (t.match(OR)) {
            n2 = new Node(t);
            n2.push(n);
            n2.push(AndExpression(t, x));
            n = n2;
        }

        return n;
    }

    function AndExpression(t, x) {
        var n, n2;

        n = BitwiseOrExpression(t, x);
        while (t.match(AND)) {
            n2 = new Node(t);
            n2.push(n);
            n2.push(BitwiseOrExpression(t, x));
            n = n2;
        }

        return n;
    }

    function BitwiseOrExpression(t, x) {
        var n, n2;

        n = BitwiseXorExpression(t, x);
        while (t.match(BITWISE_OR)) {
            n2 = new Node(t);
            n2.push(n);
            n2.push(BitwiseXorExpression(t, x));
            n = n2;
        }

        return n;
    }

    function BitwiseXorExpression(t, x) {
        var n, n2;

        n = BitwiseAndExpression(t, x);
        while (t.match(BITWISE_XOR)) {
            n2 = new Node(t);
            n2.push(n);
            n2.push(BitwiseAndExpression(t, x));
            n = n2;
        }

        return n;
    }

    function BitwiseAndExpression(t, x) {
        var n, n2;

        n = EqualityExpression(t, x);
        while (t.match(BITWISE_AND)) {
            n2 = new Node(t);
            n2.push(n);
            n2.push(EqualityExpression(t, x));
            n = n2;
        }

        return n;
    }

    function EqualityExpression(t, x) {
        var n, n2;

        n = RelationalExpression(t, x);
        while (t.match(EQ) || t.match(NE) ||
               t.match(STRICT_EQ) || t.match(STRICT_NE)) {
            n2 = new Node(t);
            n2.push(n);
            n2.push(RelationalExpression(t, x));
            n = n2;
        }

        return n;
    }

    function RelationalExpression(t, x) {
        var n, n2;

        /*
         * Uses of the in operator in shiftExprs are always unambiguous,
         * so unset the flag that prohibits recognizing it.
         */
        var x2 = x.update({ inForLoopInit: false });
        n = ShiftExpression(t, x2);
        while ((t.match(LT) || t.match(LE) || t.match(GE) || t.match(GT) ||
               (!x.inForLoopInit && t.match(IN)) ||
               t.match(INSTANCEOF))) {
            n2 = new Node(t);
            n2.push(n);
            n2.push(ShiftExpression(t, x2));
            n = n2;
        }

        return n;
    }

    function ShiftExpression(t, x) {
        var n, n2;

        n = AddExpression(t, x);
        while (t.match(LSH) || t.match(RSH) || t.match(URSH)) {
            n2 = new Node(t);
            n2.push(n);
            n2.push(AddExpression(t, x));
            n = n2;
        }

        return n;
    }

    function AddExpression(t, x) {
        var n, n2;

        n = MultiplyExpression(t, x);
        while (t.match(PLUS) || t.match(MINUS)) {
            n2 = new Node(t);
            n2.push(n);
            n2.push(MultiplyExpression(t, x));
            n = n2;
        }

        return n;
    }

    function MultiplyExpression(t, x) {
        var n, n2;

        n = UnaryExpression(t, x);
        while (t.match(MUL) || t.match(DIV) || t.match(MOD)) {
            n2 = new Node(t);
            n2.push(n);
            n2.push(UnaryExpression(t, x));
            n = n2;
        }

        return n;
    }

    function UnaryExpression(t, x) {
        var n, n2, tt;

        switch (tt = t.get(true)) {
          case DELETE: case VOID: case TYPEOF:
          case NOT: case BITWISE_NOT: case PLUS: case MINUS:
            if (tt === PLUS)
                n = new Node(t, { type: UNARY_PLUS });
            else if (tt === MINUS)
                n = new Node(t, { type: UNARY_MINUS });
            else
                n = new Node(t);
            n.push(UnaryExpression(t, x));
            break;

          case INCREMENT:
          case DECREMENT:
            // Prefix increment/decrement.
            n = new Node(t);
            n.push(MemberExpression(t, x, true));
            break;

          default:
            t.unget();
            n = MemberExpression(t, x, true);

            // Don't look across a newline boundary for a postfix {in,de}crement.
            if (t.tokens[(t.tokenIndex + t.lookahead - 1) & 3].lineno ===
                t.lineno) {
                if (t.match(INCREMENT) || t.match(DECREMENT)) {
                    n2 = new Node(t, { postfix: true });
                    n2.push(n);
                    n = n2;
                }
            }
            break;
        }

        return n;
    }

    function MemberExpression(t, x, allowCallSyntax) {
        var n, n2, name, tt;

        if (t.match(NEW)) {
            n = new Node(t);
            n.push(MemberExpression(t, x, false));
            if (t.match(LEFT_PAREN)) {
                n.type = NEW_WITH_ARGS;
                n.push(ArgumentList(t, x));
            }
        } else {
            n = PrimaryExpression(t, x);
        }

        while ((tt = t.get()) !== END) {
            switch (tt) {
              case DOT:
                n2 = new Node(t);
                n2.push(n);
                n2.push(IdentifierName(t));
                break;

              case LEFT_BRACKET:
                n2 = new Node(t, { type: INDEX });
                n2.push(n);
                n2.push(Expression(t, x));
                n2.end = t.mustMatch(RIGHT_BRACKET).end;
                break;

              case LEFT_PAREN:
                if (allowCallSyntax) {
                    n2 = new Node(t, { type: CALL });
                    n2.push(n);
                    n2.push(ArgumentList(t, x));
                    break;
                }

                // FALL THROUGH
              default:
                t.unget();
                return n;
            }

            n = n2;
        }

        return n;
    }

    function ArgumentList(t, x) {
        var n, n2;

        n = new Node(t, { type: LIST });
        if (t.match(RIGHT_PAREN, true)) {
            n.end = t.token.end;
            return n;
        }
        do {
            n2 = AssignExpression(t, x);
            if (n2.type === YIELD && !n2.parenthesized && t.peek() === COMMA)
                throw t.newSyntaxError("Yield expression must be parenthesized");
            if (t.match(FOR)) {
                n2 = GeneratorExpression(t, x, n2);
                if (n.children.length > 1 || t.peek(true) === COMMA)
                    throw t.newSyntaxError("Generator expression must be parenthesized");
            }
            n.push(n2);
        } while (t.match(COMMA));
        n.end = t.mustMatch(RIGHT_PAREN).end;

        return n;
    }

    function PrimaryExpression(t, x) {
        var n, n2, tt = t.get(true);

        switch (tt) {
          case FUNCTION:
            n = FunctionDefinition(t, x, false, EXPRESSED_FORM);
            break;

          case LEFT_BRACKET:
            n = new Node(t, { type: ARRAY_INIT });
            while ((tt = t.peek(true)) !== RIGHT_BRACKET) {
                if (tt === COMMA) {
                    t.get();
                    n.push(null);
                    continue;
                }
                n.push(AssignExpression(t, x));
                if (tt !== COMMA && !t.match(COMMA))
                    break;
            }

            // If we matched exactly one element and got a FOR, we have an
            // array comprehension.
            if (n.children.length === 1 && t.match(FOR)) {
                n2 = new Node(t, { type: ARRAY_COMP,
                                   start: n.start,
                                   expression: n.children[0],
                                   tail: ComprehensionTail(t, x) });
                n = n2;
            }
            n.end = t.mustMatch(RIGHT_BRACKET).end;
            break;

          case LEFT_CURLY:
            var id, fd;
            n = new Node(t, { type: OBJECT_INIT });

          object_init:
            if (!t.match(RIGHT_CURLY)) {
                do {
                    tt = t.get();
                    if ((t.token.value === "get" || t.token.value === "set") &&
                        t.peek() === IDENTIFIER) {
                        if (x.ecma3OnlyMode)
                            throw t.newSyntaxError("Illegal property accessor");
                        n.push(FunctionDefinition(t, x, true, EXPRESSED_FORM));
                    } else {
                        var comments = t.blockComments;
                        switch (tt) {
                          case IDENTIFIER: case NUMBER: case STRING:
                            id = new Node(t, { type: IDENTIFIER });
                            break;
                          case RIGHT_CURLY:
                            if (x.ecma3OnlyMode)
                                throw t.newSyntaxError("Illegal trailing ,");
                            break object_init;
                          default:
                            if (t.token.value in definitions.keywords) {
                                id = new Node(t, { type: IDENTIFIER });
                                break;
                            }
                            throw t.newSyntaxError("Invalid property name");
                        }
                        if (t.match(COLON)) {
                            n2 = new Node(t, { type: PROPERTY_INIT });
                            n2.push(id);
                            n2.push(AssignExpression(t, x));
                            n2.blockComments = comments;
                            n.push(n2);
                        } else {
                            // Support, e.g., |var {x, y} = o| as destructuring shorthand
                            // for |var {x: x, y: y} = o|, per proposed JS2/ES4 for JS1.8.
                            if (t.peek() !== COMMA && t.peek() !== RIGHT_CURLY)
                                throw t.newSyntaxError("missing : after property");
                            n.push(id);
                        }
                    }
                } while (t.match(COMMA));
                t.mustMatch(RIGHT_CURLY);
            }
            n.end = t.token.end;
            break;
/*
          case LEFT_PAREN:
            var start = t.token.start;
            n = ParenExpression(t, x);
            n.start = start;
            n.end = t.mustMatch(RIGHT_PAREN).end;
            n.parenthesized = true;
            break;
*/
          case LEFT_PAREN:
            n = new Node(t, {type: GROUP});
            n2 = ParenExpression(t, x);
            n.push(n2);
            n.end = t.mustMatch(RIGHT_PAREN).end;
            n2.parenthesized = true;
            break;

          case LET:
            n = LetBlock(t, x, false);
            break;

          case NULL: case THIS: case TRUE: case FALSE:
          case IDENTIFIER: case NUMBER: case STRING: case REGEXP:
            n = new Node(t);
            break;

          default:
            throw t.newSyntaxError("missing operand; found " + definitions.tokens[tt]);
            break;
        }

        return n;
    }

    /*
     * parse :: (source, filename, line number) -> node
     */
    function parse(s, f, l) {
        var t = new lexer.Tokenizer(s, f, l);
        var n = Script(t, false, false);
        if (!t.done)
            throw t.newSyntaxError("Syntax error");

        return n;
    }

    /*
     * parseStdin :: (source, {line number}, string, (string) -> boolean) -> program node
     */
    function parseStdin(s, ln, prefix, isCommand) {
        // the special .begin command is only recognized at the beginning
        if (s.match(/^[\s]*\.begin[\s]*$/)) {
            ++ln.value;
            return parseMultiline(ln, prefix);
        }

        // commands at the beginning are treated as the entire input
        if (isCommand(s.trim()))
            s = "";

        for (;;) {
            try {
                var t = new lexer.Tokenizer(s, "stdin", ln.value);
                var n = Script(t, false, false);
                ln.value = t.lineno;
                return n;
            } catch (e) {
                if (!t.unexpectedEOF)
                    throw e;

                // commands in the middle are not treated as part of the input
                var more;
                do {
                    if (prefix)
                        putstr(prefix);
                    more = readline();
                    if (!more)
                        throw e;
                } while (isCommand(more.trim()));

                s += "\n" + more;
            }
        }
    }

    /*
     * parseMultiline :: ({line number}, string | null) -> program node
     */
    function parseMultiline(ln, prefix) {
        var s = "";
        for (;;) {
            if (prefix)
                putstr(prefix);
            var more = readline();
            if (more === null)
                return null;
            // the only command recognized in multiline mode is .end
            if (more.match(/^[\s]*\.end[\s]*$/))
                break;
            s += "\n" + more;
        }
        var t = new lexer.Tokenizer(s, "stdin", ln.value);
        var n = Script(t, false, false);
        ln.value = t.lineno;
        return n;
    }

    return {
        parse: parse,
        parseStdin: parseStdin,
        Node: Node,
        DECLARED_FORM: DECLARED_FORM,
        EXPRESSED_FORM: EXPRESSED_FORM,
        STATEMENT_FORM: STATEMENT_FORM,
        Tokenizer: lexer.Tokenizer,
        FunctionDefinition: FunctionDefinition,
        Module: Module,
        Export: Export
    };

}());

    return Narcissus.parser;
});



define('narcissus',['./jsecma5', './narcissus/lib/n', './narcissus/lib/jsparse'], function(_, Narcissus, parser) {

    // from former jsmods.js:
    // module keyword is removed so that it parses like any identifier
    // (node uses 'module'; for example in the amdefine statement above)
    delete Narcissus.definitions.tokens.module;
    delete Narcissus.definitions.keywords.module;
    delete Narcissus.definitions.tokenIds.module;
    // jsmods.js used to define tkn as a global; we've added the
    // shortcut module 'tkn.js' instead.

    // don't use const; it doesn't work in strict mode
    Narcissus.hostSupportsEvalConst = false;

    return Narcissus;
});



define('fmt',[], function() {
     "use restrict";

    // String formatting
    // Call Fmt directly instead of Fmt.fmt
    // example: Fmt("Name: {0}, Age: {1}", "shaper", 0)
    //          Fmt("Name: {0}", {toString: function() { return "shaper"; }})
    function fmt(str, var_args) {
        var args = Array.prototype.slice.call(arguments, 1);
        return str.replace(/\{(\d+)\}/g, function(s, match) {
            return (match in args ? args[match] : s);
        });
    }
    // String formatting
    // example: Fmt.obj("Name: {name}, Age: {age}", {name: "shaper", age: 0})
    //          Fmt.obj("Name: {0}, Age: {1}", ["shaper", 0])
    function obj(str, obj) {
        return str.replace(/\{([_$a-zA-Z0-9][_$a-zA-Z0-9]*)\}/g, function(s, match) {
            return (match in obj ? obj[match] : s);
        });
    }
    // concat multiple strings
    function cat(var_args) {
        return String.prototype.concat.apply(String.prototype, arguments);
    }
    // abbreviate string into max characters
    function abbrev(str, max) {
        max = Math.max(Number(max) || 0, 0);
        if (str.length <= max) {
            return str;
        }
        if (max < 3) {
            return "...".slice(3 - max);
        }
        var l = Math.ceil((max - 3) / 2);
        var r = Math.floor((max - 3) / 2);
        return cat(str.slice(0, l), "...", str.slice(str.length - r, str.length));
    }
    // repeat string n times
    function repeat(str, n) {
        return (new Array(n + 1)).join(str);
    }

    // inspect object properties
    function inspect(obj, name) {
        name = name || "object";
        if (obj === null || obj === undefined) {
            return Fmt("{0} ({1})", name, obj);
        }

        var props = "";
        for (var prop in obj) {
            props += Fmt("\n    {0}: {1}", prop, obj[prop]);
        }
        return Fmt("{0} {{1}\n}", name, props);
    }

    fmt.fmt = fmt;
    fmt.obj = obj;
    fmt.cat = cat;
    fmt.abbrev = abbrev;
    fmt.repeat = repeat;
    fmt.inspect = inspect;
    return fmt;
});



define('ref',['./fmt'], function(Fmt) {
     "use restrict";

    // examples:
    // {base: obj, properties: ["property"]}
    // {base: obj, properties: ["children", "0"]
    function Ref(base, var_args) {
        this.base = base;
        this.properties = Array.isArray(var_args) ? var_args :
            Array.prototype.slice.call(arguments, 1).map(function(name) {
                return String(name);
            });
    }
    Ref.prototype.canonical = function() {
        if (this.properties.length === 1) {
            return this;
        }
        var i;
        var base = this.base;
        for (i = 0; i < this.properties.length - 1; i++) {
            base = base[this.properties[i]];
        }
        var properties = this.properties[i];
        return new Ref(base, properties);
    };
    Ref.prototype.set = function(value) {
        var ref = this.canonical();
        return ref.base[ref.properties[0]] = value;
    };
    Ref.prototype.get = function() {
        var ref = this.canonical();
        return ref.base[ref.properties[0]];
    };
    Ref.prototype.toString = function(baseName) {
        var properties = this.properties.map(function(p) {
            p = String(p);
            return /^[0-9]+$/.test(p) ? Fmt("[{0}]", p) :
                /^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(p) ? Fmt(".{0}", p) :
                Fmt('["{0}"]', p);
        });
        return (baseName !== undefined ? baseName : "base") + properties.join("");
    };
    return Ref;
});



define('log',['./fmt'], function(Fmt) {
     "use restrict";

    var _console = (typeof console !== "undefined") && console || {log: print};
    function log(var_args) {
        _console.log(format(arguments));
    }
    function format(args) {
        return args.length === 0 ? "" :
            args.length === 1 ? String(args[0]) :
            Fmt.apply(Fmt, args);
    }
    function verb(filename, lineno, fnname, var_args) {
        var args = Array.prototype.slice.call(arguments, 3);
        _console.log(Fmt("{0} line {1} <{2}>: {3}", filename, lineno, fnname, format(args)));
    }

    log.verb = verb;
    return log;
});



define('assert',[], function() {
     "use restrict";

    var printfn = (typeof console !== "undefined") && console.log || print;
    function assert(condition, var_args) {
        condition ? assert.pass(arguments) : assert.fail(arguments);
    }
    assert.pass = function(args) {
    };
    assert.fail = function(args) {
        var str = args.length === 1 ? String(args[0]) :
            Array.prototype.slice.call(args, 1).join(", ");

        throw new Error("Assertion failed: "+ str);
    };
    assert.throwsException = function(fn, var_args) {
        var res = false;
        try {
            fn();
        }
        catch (e) {
            res = true;
        }

        var args = Array.prototype.slice.call(arguments, 0);
        args.splice(1, 0, "should throw an exception");

        res ? assert.pass(args) : assert.fail(args);
    };

    return assert;
});



define('tkn',['./narcissus'], function(Narcissus) {
    // shortcut for 'tkn' definition
    return Narcissus.definitions.tokenIds;
});



define('comments',[], function() {
     "use restrict";

    // Comments.split is only used by annotater and can be vastly simplified
    function split(str) {
        if (str === undefined) {
            return [];
        }
        var arr = [];
        function push(begin, end) {
            if (begin < end) {
                arr.push(str.slice(begin, end));
            }
        }
        var NOTFOUND = Number.MAX_VALUE;
        function myIndexOf(str, match, pos) {
            var ret = str.indexOf(match, pos);
            return (ret === -1) ? NOTFOUND : ret;
        }

        var i = 0;
        var begin = 0;
        var len = str.length;
        while (i <= len) {
            var string = Math.min(myIndexOf(str, "'", i), myIndexOf(str, '"', i));
            var regexp = myIndexOf(str, "/", i);
            var frag = myIndexOf(str, "/*", i);
            var line = myIndexOf(str, "//", i);

            if (frag === NOTFOUND && line === NOTFOUND) {
                // no remaining comment, push rest
                push(begin, len);
                break;
            }
            else if (string < frag && string < line && string < regexp) {
                // string found before /*, // or regexp
                // ffwd to matching un-escaped ' or "
                var singlequote = str[string] === "'"; // true if ', false if "
                while (string < len) {
                    string = myIndexOf(str, singlequote ? "'" : '"', string + 1);
                    if (str[string - 1] !== "\\" || str[string - 2] === "\\") {
                        break;
                    }
                }
                i = string + 1;
                continue;
            }
            else if (regexp < frag && regexp < line && regexp < string) {
                // regexp found before /*, // or string
                // ffwd to matching un-escaped /
                while (regexp < len) {
                    regexp = myIndexOf(str, "/", regexp + 1);
                    if (str[regexp - 1] !== "\\" || str[regexp - 2] === "\\") {
                        break;
                    }
                }
                i = regexp + 1;
                continue;
            }
            else if (line < frag) {
                // line
                push(begin, line);
                var lf = str.indexOf("\n", line + 2);
                if (lf === -1) {
                    lf = len - 1;
                }
                i = begin = lf + 1;
                push(line, i);
            }
            else {
                // frag
                push(begin, frag);
                var starslash = str.indexOf("*/", frag + 2);
                if (starslash === -1) {
                    throw new Error("split: /* and */ mismatch in "+ str);
                }
                i = begin = starslash + 2;
                push(frag, i);
            }
        }

        if (arr.length === 0) {
            arr = [""];
        }
        return arr;
    }
    function trailing(arr) {
        if (arr.length === 0) {
            return arr;
        }
        var i = arr.length;
        while (--i >= 0 && (isComment(arr[i]) || isBlankString(arr[i]))) {
        }
        while (++i < arr.length && isBlankString(arr[i])) {
        }
        return [arr.slice(0, i).join(""), arr.slice(i).join("")];
    }
    function isBlankString(str) {
        return str.search(/\S/) === -1;
    }
    function isBlankChar(c) {
        return c === " " || c === "\t" || c === "\r" || c === "\n" ||
            c === "\f" || c === "\v";
    }
    function isComment(str) {
        // string begins with // or /*
        return str.search(/(^\/\/)|(^\/\*)/) === 0;
    }


    // Creates a comment-array with following indices for each comment:
    // comment = {
    //     prev: 8, // prev non-comment non-blank character
    //     start: 10,
    //     end: 18,
    //     next: 19 // next non-comment non-blank character
    // };
    function indexArray(src, commentIndices) {
        var splits = [];
        var pos = 0;
        var i;
        for (i = 0; i < commentIndices.length; i++) {
            if (commentIndices[i].start !== 0) {
                splits.push(src.slice(pos, commentIndices[i].start));
            }
            splits.push(src.slice(commentIndices[i].start, commentIndices[i].end));
            pos = commentIndices[i].end;
        }
        if (pos < src.length) {
            splits.push(src.slice(pos, src.length));
        }

        var comments = [];
        i = 0;
        pos = 0;

        while (i < splits.length) {
            // skip non-comment (if any)
            if (!isComment(splits[i])) {
                pos += splits[i].length;
                if (++i >= splits.length) {
                    break;
                }
            }

            var comment = {};

            // prev non-comment non-whitespace character + 1
            // (used to match with node.end's)
            comment.prev = pos;
            while (comment.prev > 0 && isBlankChar(src[comment.prev - 1])) {
                --comment.prev;
            }

            comment.start = pos;

            // skip until first text
            // (skip //, /**/ and whitespace)
            do {
                pos += splits[i].length;
            } while (++i < splits.length && (isComment(splits[i]) || isBlankString(splits[i])));

            // next non-comment non-whitespace character + 1
            // (used to match with node.start's)
            comment.next = comment.end = pos;
            while (comment.next < src.length && isBlankChar(src[comment.next])) {
                ++comment.next;
            }
            comments.push(comment);
        }

        return comments;
    }

    return {
        split: split,
        trailing: trailing,
        isBlankString: isBlankString,
        isComment: isComment,
        indexArray: indexArray
    };
});



define('shaper',['./narcissus', './fmt', './ref', './log', './assert', './comments', './tkn'], function(Narcissus, Fmt, Ref, Log, Assert, Comments, tkn) {
 "use restrict";

var log = (typeof console !== "undefined") && console.log || print;

var Shaper = (function() {
    Array.isArray = Array.isArray || function(o) {
        return Object.prototype.toString.call(o) === "[object Array]";
    };
    function error(node, msg) {
        var str = Fmt("{0}:{1} error: {2}", node.tokenizer.filename, node.lineno, msg);
        if (typeof process !== "undefined") {
            log(str);
            process.exit(-1);
        }
        else {
            throw new Error(str);
        }
    }
    function deprecated(obj, params) {
        obj[params.was] = function() {
            throw new Error(Fmt.obj((params.now ?
                                     "{was} is deprecated since version {since}, use {now} instead" :
                                     "{was} is deprecated since version {since}"), params));
        };
    }

    var traverseData = (function() {
        var o = [];

        o[tkn.ARRAY_COMP] = [/*expr*/"expression", /*COMP_TAIL*/"tail"];
        o[tkn.CASE] = [/*expr*/"caseLabel", /*BLOCK*/"statements"];
        o[tkn.CATCH] = [/*IDENTIFIER*/"_name", /*expr*/"guard", /*BLOCK*/"block"];
        o[tkn.COMP_TAIL] = [/*[FOR_IN]*/"children", /*expr*/"guard"]; // has children but not last
        o[tkn.DEFAULT] = [/*BLOCK*/"statements"];
        o[tkn.DO] = [/*stmt*/"body", /*expr*/"condition"];
        o[tkn.FOR] = [/*expr*/"setup", /*expr*/"condition", /*expr*/"update", /*stmt*/"body"];
        o[tkn.FOR_IN] = [/*IDENTIFIER|VAR*/"_iterator", /*expr*/"object", /*stmt*/"body"];
        o[tkn.FUNCTION] = [/*IDENTIFIER*/"_name", /*[IDENTIFIER]*/"_params", /*SCRIPT*/"body"];
        o[tkn.GENERATOR] = [/*stmt*/"body", /*expr*/"expression", /*COMP_TAIL*/"tail"];
        o[tkn.GETTER] = [/*SCRIPT*/"body"];
        o[tkn.IF] = [/*expr*/"condition", /*stmt*/"thenPart", /*stmt*/"elsePart"];
        o[tkn.LABEL] = [/*IDENTIFIER*/"_label", /*stmt*/"statement"];
        o[tkn.LET_BLOCK] = [/*LET*/"variables", /*expr*/"expression", /*BLOCK*/"block"];
        o[tkn.RETURN] = [/*expr*/"value"];
        o[tkn.SEMICOLON] = [/*expr*/"expression"];
        o[tkn.SETTER] = [/*SCRIPT*/"body"];
        o[tkn.SWITCH] = [/*expr*/"discriminant", /*[CASE|DEFAULT]*/"cases"];
        o[tkn.THROW] = [/*expr*/"exception"];
        o[tkn.TRY] = [/*BLOCK*/"tryBlock", /*[CATCH]*/"catchClauses", /*BLOCK*/"finallyBlock"];
        o[tkn.WHILE] = [/*expr*/"condition", /*stmt*/"body"];
        o[tkn.WITH] = [/*expr*/"object", /*stmt*/"body"];
        o[tkn.YIELD] = [/*expr*/"value"];

        var c = [
            /*[stmt]*/
            tkn.SCRIPT, tkn.BLOCK,

            /*[expr]*/
            tkn.COMMA,

            /*expr*/
            tkn.GROUP,

            /*[expr]*/
            tkn.ARRAY_INIT,

            /*[PROPERTY_INIT]*/
            tkn.OBJECT_INIT,

            /*IDENTIFIER, expr*/
            tkn.PROPERTY_INIT,

            /*[ASSIGN|IDENTIFIER]*/
            tkn.LET, tkn.VAR, tkn.CONST,

            /*expr*/
            tkn.NEW,

            /*expr, LIST*/
            tkn.NEW_WITH_ARGS,

            /*expr, LIST*/
            tkn.CALL,

            /*[expr]*/
            tkn.LIST,

            /*expr, expr, expr (ternary operator)*/
            tkn.HOOK,

            /*expr, expr (binary operator)*/
            tkn.PLUS, tkn.MINUS, tkn.MUL, tkn.DIV, tkn.MOD,
            tkn.LSH, tkn.RSH, tkn.URSH,
            tkn.OR, tkn.AND,
            tkn.BITWISE_OR, tkn.BITWISE_XOR, tkn.BITWISE_AND,
            tkn.EQ, tkn.NE, tkn.STRICT_EQ, tkn.STRICT_NE,
            tkn.LT, tkn.LE, tkn.GE, tkn.GT,
            tkn.IN, tkn.INSTANCEOF,
            tkn.INDEX,

            /*IDENTIFIER|DOT|INDEX, expr (binary operator)*/
            tkn.ASSIGN,

            /*expr, IDENTIFIER (binary operator)*/
            tkn.DOT,

            /*IDENTIFIER|DOT|INDEX (unary operator)*/
            tkn.INCREMENT, tkn.DECREMENT,

            /*expr (unary operator)*/
            tkn.UNARY_PLUS, tkn.UNARY_MINUS,
            tkn.NOT, tkn.BITWISE_NOT,
            tkn.DELETE, tkn.VOID, tkn.TYPEOF
        ];

        // add "children" to all tokens enumerated in c
        for (var i = 0; i < c.length; i++) {
            if (o[c[i]]) {
                throw new Error("createTraverseData: don't know ordering so "+
                                "can't add 'children' to existing traverseData");
            }
            o[c[i]] = ["children"];
        }

        return o;
    })();

    var extraTraverseData = (function() {
        var x = {};
        // These properties aren't nodes but may still be relevant
        x[tkn.ASSIGN] = ["assignOp"]; // number ("value" has string representation)
        x[tkn.INCREMENT] = ["postfix"]; // boolean ("value" is just "++")
        x[tkn.DECREMENT] = ["postfix"]; // boolean
        x[tkn.FUNCTION] = ["functionForm"]; // number
        x[tkn.FOR_IN] = ["isEach"]; // boolean
        x[tkn.SWITCH] = ["defaultIndex"]; // number
        x[tkn.IDENTIFIER] = ["value"]; // string, same as "name" when part of VAR
        x[tkn.NUMBER] = ["value"]; // number (can differ from srcs)
        x[tkn.REGEXP] = ["value"]; // string
        x[tkn.STRING] = ["value"]; // string (can differ from srcs)
        return x;
    })();

    //// generic traverse
    // visitfns: {pre: function, post: function}
    // visit function signature: function(node, ref)
    function traverse(node, visitfns, ref) {
        // preconditions
        if (!node) {
            return node;
        }
        if (!(node instanceof Narcissus.parser.Node)) {
            throw new Error(Fmt("traverse: expected Node, got {0}. {1}",
                                typeof node, ref));
        }
        ref = ref || new Ref();

        // call pre callback, if any
        if (visitfns.pre) {
            var old = node;
            node = visitfns.pre(node, ref) || node;
            if (node === "break") {
                return old;
            }
            else if (!(node instanceof Narcissus.parser.Node)) {
                throw new Error("traverse: visitfns.pre invalid return type");
            }
        }

        // traverse descendants
        var subprops = traverseData[node.type] || [];
        for (var i = 0; i < subprops.length; i++) {
            var prop = subprops[i];
            if (Array.isArray(node[prop])) {
                for (var j = 0; j < node[prop].length; j++) {
                    traverse(node[prop][j], visitfns, new Ref(node, prop, j));
                }
            }
            else {
                traverse(node[prop], visitfns, new Ref(node, prop));
            }
        }

        // call post callback, if any
        if (visitfns.post) {
            node = visitfns.post(node, ref) || node;
            if (!(node instanceof Narcissus.parser.Node)) {
                throw new Error("traverse: visitfns.post invalid return type");
            }
        }

        return node;
    }

    var MISMATCH = 0;
    var MATCH = 1;
    var MATCH_REST = 2;
    function matchCondition(node, cond) {
        // TODO cond.capture invokes callback or stores in array?

        // cond is a function
        if (typeof cond === "function") {
            return cond(node) ? cond : false;
        }
        // cond is an object
        if (typeof cond !== "object") {
            throw new Error("matchCondition: expected function or object, got "+ typeof cond);
        }
        for (var key in cond) {
            var condVal = cond[key];
            // special
            if (key === "rest" && condVal) {
                continue;
            }
            var nodeVal = node[key];
            //  cond.key is a function
            if (typeof condVal === "function") {
                if (!condVal(nodeVal)) {
                    return false;
                }
            }
            // cond.key is a value
            else if (!(condVal === nodeVal || isNaN(condVal) && isNaN(nodeVal))) {
                return false;
            }
        }
        return cond;
    }

    match.debug = false;
    function match(t, n, conds) {
        var i;
        if (typeof t === "string") {
            t = Shaper.parse(t);
        }
        if (typeof n === "string") {
            throw new Error("match: expected second argument of type Node, got string");
        }
        conds = conds || {$: {}, $$: {rest: true}};

        if (t && t.type === tkn.IDENTIFIER) {
            var cond = conds[t.value];
            // todo should conds match null/undefined?
            if (cond !== undefined) {
                if (matchCondition(n, cond)) {
                    return cond.rest ? MATCH_REST : MATCH;
                }
            }
        }
        if (!t || !n) {
            match.debug && Log("{2} {0} {1}", t, n, !t === !n ? "match" : "mismatch");
            return !t === !n ? MATCH : MISMATCH;
        }
        if (t.type !== n.type) {
            // fail (type mismatch)
            match.debug && Log("mismatch {0} {1}", t, n);
            return MISMATCH;
        }
        if (t.type === tkn.IDENTIFIER ||
            t.type === tkn.NUMBER ||
            t.type === tkn.REGEXP ||
            t.type === tkn.STRING) {
            if (t.value === n.value ||
                (t.type === tkn.NUMBER && isNaN(t.value) && isNaN(n.value))) {
                // ok (terminals with matching values)
                match.debug && Log("match {0} {1}", t, n);
                return MATCH;
            }
            else {
                // fail (terminals with different values)
                match.debug && Log("mismatch {0} {1}", t, n);
                return MISMATCH;
            }
        }
        var extraprops = extraTraverseData[t.type] || [];
        for (i = 0; i < extraprops.length; i++) {
            var extra = extraprops[i];
            if (extra === 'value') {
                // handled above.
                continue;
            }
            if (t[extra] !== n[extra]) {
                match.debug && Log("mismatch {0} {1} {2}",
                                   extra, t[extra], n[extra]);
                return MISMATCH;
            }
        }

        // traverse descendants
        var subprops = traverseData[t.type] || [];
        var res;
        for (i = 0; i < subprops.length; i++) {
            var prop = subprops[i];
            // t[prop] is an array, such as BLOCK.children
            if (Array.isArray(t[prop])) {
                var rest = null; // bound to MATCH_REST node, if any

                for (var j = 0, k = Math.max(t[prop].length, n[prop].length);
                     j < k; j++) {
                    var tt = rest || t[prop][j];
                    var nn = n[prop][j];
                    if (!tt || !nn) { // nodes or template starved (both can't be)
                        match.debug && Log("mismatch {0} {1}", tt, nn);
                        return MISMATCH;
                    }

                    res = match(tt, nn, conds);
                    if (res === MISMATCH) {
                        match.debug && Log("mismatch {0} {1}", tt, nn);
                        return MISMATCH;
                    }
                    else if (res === MATCH_REST) {
                        rest = tt;
                        match.debug && Log("match_rest {0} {1}", tt, nn);
                    }
                }
            }
            // t[prop] is a regular node, such as IF.thenPart
            else {
                res = match(t[prop], n[prop], conds);
                if (res === MISMATCH) {
                    match.debug && Log("mismatch {0} {1}", t[prop], n[prop]);
                    return MISMATCH;
                }
                // MATCH or MATCH_REST matches this node
            }
        }
        match.debug && Log("match {0} {1}", t, n);
        return MATCH;
    }

    //// mutate nodes
    function replace(node, var_args) {
        if (typeof node === "string") {
            node = Shaper.parse(node);
        }

        var placeholders = [];
        //collect all $ nodes into placeholders array
        traverse(node, {pre: function(node, ref) {
            if (node.type === tkn.IDENTIFIER && node.value === "$") {
                placeholders.push(ref);
            }
        }});
        var args = arguments.length === 2 && Array.isArray(var_args) ?
            var_args :
            Array.prototype.slice.call(arguments, 1);
        if (args.length !== placeholders.length) {
            throw new Error("replace: placeholders.length mismatch");
        }

        // replace placeholders with new nodes
        for (var i = 0; i < placeholders.length; i++) {
            placeholders[i].set(args[i]);
        }

        return node;
    }
    function renameIdentifier(node, name) {
        Assert(node.type === tkn.IDENTIFIER);
        node.value = node.srcs[0] = name;
    }
    function remove(ref) {
        Assert(ref.properties.length === 2);
        var node = ref.base;
        var prop = ref.properties[0];
        var index = Number(ref.properties[1]);
        var len = node[prop].length;
        Assert(index >= 0 && index < len);

        if (len === 1) {
            node.srcs[0] += node.srcs.pop();
        }
        else {
            node.srcs.splice(index === len - 1 ? index : index + 1, 1);
        }
        node[prop].splice(index, 1);
    }
    // When the delimiter is (e.g.) a comma, like when adding elements to a
    // list, we don't want to add the delimiter if the new element would be
    // the last child (or if the parent initially had no children).  But if
    // the delimiter is whitespace or newlines, we want to always add the
    // delimiter.  Use the optional 'alwaysDelimit' parameter to distinguish
    // these two cases.
    function insertBefore(ref, node, delimiter, alwaysDelimit) {
        Assert(ref.properties.length === 2);
        _insert(ref.base, node, ref.properties[0], Number(ref.properties[1]), delimiter, alwaysDelimit);
    }
    function insertAfter(ref, node, delimiter, alwaysDelimit) {
        Assert(ref.properties.length === 2);
        _insert(ref.base, node, ref.properties[0], Number(ref.properties[1]) + 1, delimiter, alwaysDelimit);
    }
    function _insert(node, child, prop, pos, delimiter, alwaysDelimit) {
        var srcs = node.srcs;
        var children = node[prop];
        if (pos === -1) {
            pos = children.length;
        }
        Assert(pos >= 0 && pos <= children.length);

        // no children thus srcs could be in style "(/*comments, whitespace*/ )"
        // -> srcs: ["(/*comments, whitespace*/ ", ")"]
        if (children.length === 0) {
            var parens = srcs.pop();
            var last = parens.length - 1;
            var d = (alwaysDelimit && delimiter) ? delimiter : '';
            srcs.push(parens.slice(0, last), d + parens.slice(last));
            children.push(child);
        }
        // has children already, insert new delimiter in srcs
        else {
            // create default delimiter if possible
            if (delimiter === undefined) {
                // get indentation from first node in SCRIPT, minus { character if any
                if (node.type === tkn.SCRIPT || node.type === tkn.BLOCK) {
                    delimiter = (srcs[0][0] === "{" ? srcs[0].slice(1) : srcs[0]);
                }
                else if (node.type === tkn.LIST) {
                    delimiter = ", ";
                }
                else {
                    throw new Error("_insert: Can't create default delimiter for node "+ node.toString(false));
                }
            }

            // temporary hardcoded workaround for semicolon issues
            // `{ var x; }` BLOCK has no SEMICOLON, block.srcs is { @; }
            var splicePos = (pos === children.length ? pos : pos + 1);
            if (splicePos === children.length && (node.type === tkn.SCRIPT || node.type === tkn.BLOCK)) {
                if (srcs[children.length][0] === ";") {
                    srcs[children.length] = srcs[children.length].slice(1);
                    delimiter = ";"+ delimiter;
                }
            }
            srcs.splice(splicePos, 0, delimiter);
            children.splice(pos, 0, child);
        }
    }
    function cloneComments(dst, src) {
        if (src.leadingComment !== undefined) {
            dst.leadingComment = src.leadingComment;
        }
        if (src.trailingComment !== undefined) {
            dst.trailingComment = src.trailingComment;
        }
    }


    //// printers
    var Node = Narcissus.parser.Node;
    Node.prototype.verboseString = (function(oldToString) {
        return function(recurse) {
            if (recurse === undefined) {
                recurse = true;
            }
            var res;
            var newToString = Node.prototype.toString;
            if (recurse === true) {
                Node.prototype.toString = oldToString;
                res = this.toString();
            }
            else {
                Node.prototype.toString = function() {
                    return newToString.call(this, false);
                };
                res = oldToString.call(this);
            }
            Node.prototype.toString = newToString;
            return res;
        };
    })(Node.prototype.toString);
    Node.prototype.tknString = function() {
        var tt = this.type;
        var defs = Narcissus.definitions;
        var t = defs.tokens[tt];
        return /^\W/.test(t) ? defs.opTypeNames[t] : t.toUpperCase();
    };
    Node.prototype.toString = function(recurse) {
        if (recurse === undefined) {
            recurse = true;
        }
        return recurse ? treeString(this) : nodeString(this);
    };
    function nodeString(node) {
        function strPos(pos) {
            return pos === undefined ? "?" : String(pos);
        }
        var src = node.tokenizer.source;

        return node.tknString() +": "+
            ("srcs" in node ? Fmt.abbrev(JSON.stringify(node.srcs.join("@")).slice(1,-1), 60) :
             "start" in node && "end" in node ?
             Fmt(" '{0}'", JSON.stringify(Fmt.abbrev(src.slice(node.start, node.end), 30))) :
             (node.value !== undefined ? Fmt(" ({0})", node.value) : "")) +
            ("start" in node || "end" in node ?
             Fmt(" ({0}..{1})", strPos(node.start), strPos(node.end)) : "");
    };
    function treeString(node) {
        var level = 0;
        var lines = [];
        traverse(node, {
            pre: function(node, ref) {
                var comments = [];
                if (node.leadingComment) {
                    comments.push("leadingComment: "+ (Fmt.abbrev(node.leadingComment, 20) || ""));
                }
                if (node.trailingComment) {
                    comments.push("trailingComment: "+ (Fmt.abbrev(node.trailingComment, 20) || ""));
                }
                comments = comments.join(", ");

                lines.push(Fmt("{0}{1}  < {2}{3}",
                               Fmt.repeat(" ", level * 2),
                               nodeString(node),
                               ref.base ? ref.toString(ref.base.tknString()) : "root",
                               comments ? "  "+ JSON.stringify(comments).slice(1, -1) : ""));
                ++level;
            },
            post: function(node, ref) {
                --level;
            }
        });
        return lines.join("\n");
    }
    Node.prototype.getSrc = function() {
        var srcs = [];
        traverse(this, {
            pre: function(node, ref) {
                var parent = ref.base;
                if (parent) {
                    srcs.push(parent.srcs[parent.nPushed++]);
                }
                node.nPushed = 0;
                if (node.leadingComment !== undefined) {
                    srcs.push(node.leadingComment);
                }
            },
            post: function(node, ref) {
                srcs.push(node.srcs[node.nPushed++]);
                if (node.trailingComment !== undefined) {
                    srcs.push(node.trailingComment);
                }
                delete node.nPushed;
            }
        });
        return srcs.join("");
    };


    //// parse and adjust
    function parseScript(str, filename) {
        return srcsify(adjustStartEnd(adjustComments(adjustStartEnd(Narcissus.parser.parse(str, filename || "<no filename>", 1)))));
    }
    function parse(str) {
        var script = parseScript(str);

        // only one statement/expression so skip SCRIPT node
        if (script.children.length === 1) {
            return script.children[0];
        }

        // SCRIPT contains multiple statements/expressions so return as-is
        return script;
    }
    function adjustStartEnd(root) {
        root.start = 0;
        root.end = root.tokenizer.source.length;

        return traverse(root, {post: function(node, ref) {
            var parent = ref.base;
            if (parent) {
                if (parent.start === undefined || parent.end === undefined ||
                    node.start === undefined || node.end === undefined) {
                    throw new Error("adjustStartEnd: undefined start/end");
                }
                parent.start = Math.min(parent.start, node.start);
                parent.end = Math.max(parent.end, node.end);
            }
        }});
    }
    function adjustComments(root) {
        var comments = Comments.indexArray(root.tokenizer.source, root.tokenizer.comments);

        // extend node.start to left to cover leading comment
        // before: /*c*/ x*y+z, after: /*c*/ x*y+z
        //               -----         -----------
        var i = 0;
        try {
            traverse(root, {pre: function(node, ref) {
                while (true) {
                    if (i === comments.length) {
                        throw true; // abort traversal
                    }
                    else if (comments[i].next > node.start) {
                        return undefined;
                    }
                    else if (comments[i].next === node.start) {
                        node.origStart = node.start;
                        node.start = comments[i].start;
                        comments[i] = null;
                    }
                    ++i;
                }
            }});
        } catch (e) {}

        // extend node.end to right to cover trailing comment
        // before: x*y+z /*c*/, after: x*y+z /*c*/
        //             -                   -------
        i = 0;
        try {
            traverse(root, {post: function(node, ref) {
                while (true) {
                    while (i < comments.length && comments[i] === null) {
                        ++i;
                    }
                    if (i === comments.length) {
                        throw true; // abort traversal
                    }
                    if (comments[i].prev > node.end) {
                        return undefined;
                    }
                    if (comments[i].prev === node.end) {
                        node.origEnd = node.end;
                        node.end = comments[i].end;
                        comments[i] = null;
                    }
                    ++i;
                }
            }});
        } catch (e) {}

        return root;
    }
    function srcsify(root) {
        var tokenizer = {
            source: "",
            filename: root.tokenizer.filename,
            comments: root.tokenizer.comments
        };

        return traverse(root, {
            pre: function(node, ref) {
                var parent = ref.base;
                node.pos = node.start;
                node.srcs = [];

                var src;
                if (parent) {
                    if (parent.pos > node.start ||
                       node.start === undefined || node.end === undefined) {
                        throw new Error(Fmt("srcsify: src already covered. parent: {0} {1}:{2}",
                                            parent, ref, node.toString(false)));
                    }
                    src = parent.tokenizer.source;
                    var frag = src.slice(parent.pos, node.start);
                    parent.srcs.push(frag);
                    parent.pos = node.end;
                }
                if (node.origStart !== undefined) { // has leadingComment
                    src = node.tokenizer.source;
                    node.leadingComment = src.slice(node.pos, node.origStart);
                    node.pos = node.origStart;
                }
            },
            post: function(node, ref) {
                var src = node.tokenizer.source;
                if (node.origEnd !== undefined) { // has trailingComment
                    node.srcs.push(src.slice(node.pos, node.origEnd));
                    node.trailingComment = src.slice(node.origEnd, node.end);
                }
                else {
                    node.srcs.push(src.slice(node.pos, node.end));
                }
                delete node.pos;
                delete node.start;
                delete node.end;
                delete node.origStart;
                delete node.origEnd;
                node.tokenizer = tokenizer;
                //delete node.tokenizer;
            }
        });
    }

    // register shapes and run pipeline
    var shapes = {};
    function shaper(name, fn) {
        shapes[name] = fn;
    }
    function get(name) {
        return shapes[name];
    }
    function run(root, pipeline) {
        for (var i = 0; i < pipeline.length; i++) {
            var shape = pipeline[i];
            if (typeof shape !== "function") {
                shape = shapes[shape];
            }
            root = shape(root) || root;
        }
        return root;
    }

    shaper("tree", function(root) {
        log(root.toString());
    });
    shaper("source", function(root) {
        var write = function(str) {
            // log is going to add a trailing newline, so suppress the last one
            // from str (if that's actually what it ends with)
            if (str[str.length-1]=='\n') {
                str = str.substring(0, str.length-1);
            }
            log(str);
        };
        // if we have a "print without trailing newline" function available,
        // use it instead.
        if (typeof process !== 'undefined') {
            // node uses process.stdout.write
            if (process.stdout && typeof process.stdout.write === 'function') {
                write = process.stdout.write.bind(process.stdout);
            }
        }

        var str = root.getSrc();
        write(str);
    });
    shaper("version", function(root) {
        log(Fmt("Shaper for JavaScript version {0}", shaper.version));
    });

    shaper.error = error;
    shaper.traverse = traverse;
    shaper.match = match;
    shaper.replace = replace;
    shaper.renameIdentifier = renameIdentifier;
    shaper.remove = remove;
    shaper.insertBefore = insertBefore;
    shaper.insertAfter = insertAfter;
    shaper.cloneComments = cloneComments;
    shaper.parseScript = parseScript;
    shaper.parse = parse;
    shaper.get = get;
    shaper.run = run;
    shaper.tkn = tkn;

    deprecated(shaper, {since: "0.1", was: "parseExpression", now: "parse"});
    deprecated(shaper, {since: "0.1", was: "insertArgument", now: "insertBefore or insertAfter"});
    deprecated(shaper, {since: "0.1", was: "traverseTree", now: "traverse"});
    deprecated(Node.prototype, {since: "0.1", was: "printTree", now: "toString"});

    shaper.version = "0.1-pre";

    return shaper;
})();

    return Shaper;
});



define('plugins/annotater',['../shaper', '../comments'], function(Shaper, Comments) {
 "use restrict";

Shaper("annotater", function(root) {
    Shaper.traverse(root, {pre: function(node, ref) {
        // collect leading comments (whitespace excluded)
        var comments = [];
        var split = Comments.split(node.leadingComment);
        for (var i = 0; i < split.length; i++) {
            var str = split[i];
            if (Comments.isComment(str)) {
                comments.push(str);
            }
            else if (!Comments.isBlankString(str)) {
                break;
            }
        }

        // match comments with annotater matchers
        for (i = 0; i < Annotater.matchers.length; i++) {
            var matcher = Annotater.matchers[i];

            for (var j = 0; j < comments.length; j++) {
                var comment = comments[j];

                var annotation = comment.match(matcher.re);
                if (annotation === null) {
                    continue;
                }
                var fn = matcher.applyfn;
                fn(node, annotation);
            }
        }
    }});
});

function Annotater(re, applyfn) {
    Annotater.matchers.push({re: re, applyfn: applyfn});
}
Annotater.matchers = [];

return Annotater;
});



define('plugins/bitwiser',['../shaper','./annotater','../tkn'], function(Shaper, Annotater, tkn) {
 "use restrict";

Shaper("bitwiser", function(root) {
    var bitwise_stack = [];
    return Shaper.traverse(root, {
        pre: function(node, ref) {
            if (node.bitwise) {
                bitwise_stack.push(true);
            }
            if (node.type === tkn.BITWISE_OR && bitwise_stack.length === 0) {
                Shaper.error(node, "bitwise or (|) detected without /* @bitwise */ annotation\n"+
                             "  did you mean to use ||?");
            }
            if (node.type === tkn.BITWISE_AND && bitwise_stack.length === 0) {
                Shaper.error(node, "bitwise and (&) detected without /* @bitwise */ annotation\n"+
                             "  did you mean to use &&?");
            }
        },
        post: function(node, ref) {
            if (node.bitwise) {
                bitwise_stack.pop();
            }
        }
    });
});

Annotater(/\/\*+\s*@bitwise\s*\*+\//, function(node, match) {
    node.bitwise = true;
});

return Shaper.get("bitwiser");
});



define('plugins/asserter',['../shaper', '../fmt', '../ref', '../tkn'], function(Shaper, Fmt, Ref, tkn) {
 "use restrict";

Shaper("asserter", function(root) {
    var fns = [];
    var callTempl = Shaper.parse("Assert($$)");
    var dotTempl = Shaper.parse("Assert.$($$)");
    return Shaper.traverse(root, {
        pre: function(node, ref) {
            if (node.type === tkn.FUNCTION) {
                fns.push(node);
            }
            if (Shaper.match(callTempl, node) || Shaper.match(dotTempl, node)) {
                var args = node.children[1];
                var str = Fmt('{0}, function {1}, file {2}, line {3}',
                              args.children[0].getSrc(),
                              fns.length === 0 ? "<script>" :
                              fns[fns.length - 1].name || "<anonymous>",
                              node.tokenizer.filename,
                              node.lineno);
                Shaper.insertBefore(new Ref(args, "children", args.children.length), Shaper.parse(JSON.stringify(str)));
            }
        },
        post: function(node, ref) {
            if (node.type === tkn.FUNCTION) {
                fns.pop();
            }
        }});
});

    return Shaper.get("asserter");
});



define('plugins/restricter',['../shaper', '../fmt', '../tkn', './annotater'], function(Shaper, Fmt, tkn, Annotater) {
 "use restrict";

Shaper("restricter", function(root) {
    var restrictfns = [];
    restrictfns[tkn.EQ] = "__eq($, $)";
    restrictfns[tkn.NE] = "__ne($, $)";
    restrictfns[tkn.LT] = "__lt($, $)";
    restrictfns[tkn.GT] = "__gt($, $)";
    restrictfns[tkn.LE] = "__le($, $)";
    restrictfns[tkn.GE] = "__ge($, $)";

    restrictfns[tkn.PLUS] = "__add($, $)";
    restrictfns[tkn.MINUS] = "__sub($, $)";
    restrictfns[tkn.MUL] = "__mul($, $)";
    restrictfns[tkn.DIV] = "__div($, $)";
    restrictfns[tkn.MOD] = "__mod($, $)";

    // INCREMENT, DECREMENT prefix, postfix

    restrictfns[tkn.UNARY_PLUS] = "__uplus($)";
    restrictfns[tkn.UNARY_MINUS] = "__neg($)";
    restrictfns[tkn.BITWISE_AND] = "__bitand($, $)";
    restrictfns[tkn.BITWISE_OR] = "__bitor($, $)";
    restrictfns[tkn.BITWISE_XOR] = "__bitxor($, $)";
    restrictfns[tkn.LSH] = "__bitasl($, $)";
    restrictfns[tkn.RSH] = "__bitasr($, $)";
    restrictfns[tkn.URSH] = "__bitlsr($, $)";
    restrictfns[tkn.BITWISE_NOT] = "__bitnot($)";

    // ASSIGN with .assignOp

    var useRestrictStack = [false]; // TODO change default via options
    function checkerPost(node, ref) {
        if (node.type === tkn.SCRIPT) {
            useRestrictStack.pop();
        }
    }
    function checkerPre(node, ref) {
        // don't alter @loose annotated nodes or children
        if (node.loose) {
            return "break";
        }

        // detect "use restrict"; literal in beginning of script/function
        if (node.type === tkn.SCRIPT) {
            var inRestrict = useRestrictStack.top();
            for (var i = 0; i < node.children.length; i++) {
                var c = node.children[i];
                if (c.type === tkn.SEMICOLON) {
                    c = c.expression;
                }
                if (c.type !== tkn.STRING) {
                    break;
                }
                if (c.value.search("^use restrict") === 0) {
                    inRestrict = c.value;
                    break;
                }
            }
            useRestrictStack.push(inRestrict);
        }

        // don't alter node if we're not in restrict mode (but continue traversal)
        if (useRestrictStack.top() === false) {
            return undefined;
        }

        var replaceNode;
        if (restrictfns[node.type] !== undefined) {
            replaceNode = Shaper.parse(restrictfns[node.type]);
            if (node.children.length === 1) {
                Shaper.replace(replaceNode, node.children[0]);
            }
            else {
                Shaper.replace(replaceNode, node.children[0], node.children[1]);
            }
        }
        // ++ -- += -= *= /= %= &= |= ^= <<= >>= >>>=
        //
        // id += v is translated into id = __add(id, v)
        // expr.id += v is translated into __op_set(__add, expr, "id", v)
        // expr1[expr2] += v is translated into __op_set(__add, expr1, String(expr2), v)
        //
        // ++id is translated into (id = __inc(id))
        // ++expr.id is translated into __prefinc(expr, "id")
        // ++expr1[expr2] is translated into __prefinc(expr1, String(expr2))
        //
        // id++ is translated into __arg0(id, id = __inc(id))
        // expr.id++ is translated into __postinc(expr, "id")
        // expr1[expr2]++ is translated into __postinc(expr1, String(expr2))
        //
        // all other forms, for example ofn() += 1, throws ReferenceError so
        // give translation error
        else if (node.type === tkn.INCREMENT || node.type === tkn.DECREMENT) {
            var c = node.children[0];
            var __op = node.type === tkn.INCREMENT ? "__inc" : "__dec";
            var __postprefop = (node.postfix ? "__post" : "__pref") + (node.type === tkn.INCREMENT ? "inc" : "dec");

            // extract c from ((c)) if needed
            while (c.type === tkn.GROUP) {
                c = c.children[0];
            }

            if (c.type === tkn.IDENTIFIER) { // id++
                if (node.postfix) {
                    replaceNode = Shaper.parse(Fmt("__arg0($, $ = {0}($))", __op));
                    Shaper.replace(replaceNode, c, c, c);
                }
                else {
                    replaceNode = Shaper.parse(Fmt("($ = {0}($))", __op));
                    Shaper.replace(replaceNode, c, c);
                }
            }
            else if (c.type === tkn.DOT) { // expr.id++
                var expr = c.children[0];
                var id = c.children[1];
                replaceNode = Shaper.parse(Fmt('{0}($, "{1}")', __postprefop, id.value));
                Shaper.replace(replaceNode, expr);
            }
            else if (c.type === tkn.INDEX) { // expr1[expr2]++
                var expr1 = c.children[0];
                var expr2 = c.children[1];
                if (expr2.type === tkn.STRING) {
                    replaceNode = Shaper.parse(Fmt("{0}($, $)", __postprefop));
                }
                else {
                    replaceNode = Shaper.parse(Fmt("{0}($, String($))", __postprefop));
                }
                Shaper.replace(replaceNode, expr1, expr2);
            }
            else {
                throw new Error("replace: invalid INCREMENT/DECREMENT form");
            }
        }
        else if (node.type === tkn.ASSIGN && node.assignOp) {
            var lvalue = node.children[0];
            var v = node.children[1];
            var __opcall = restrictfns[node.assignOp];
            var __op = __opcall.slice(0, __opcall.indexOf("("));

            // extract lvalue from ((lvalue)) if needed
            while (lvalue.type === tkn.GROUP) {
                lvalue = lvalue.children[0];
            }

            if (lvalue.type === tkn.IDENTIFIER) { // id += v
                replaceNode = Shaper.parse(Fmt("$ = {0}($, $)", __op));
                Shaper.replace(replaceNode, lvalue, lvalue, v);
            }
            else if (lvalue.type === tkn.DOT) { // expr.id += v
                var expr = lvalue.children[0];
                var id = lvalue.children[1];
                replaceNode = Shaper.parse(Fmt('__op_set({0}, $, "{1}", $)', __op, id.value));
                Shaper.replace(replaceNode, expr, v);
            }
            else if (lvalue.type === tkn.INDEX) { // expr1[expr2] += v
                var expr1 = lvalue.children[0];
                var expr2 = lvalue.children[1];
                if (expr2.type === tkn.STRING) {
                    replaceNode = Shaper.parse(Fmt('__op_set({0}, $, $, $)', __op));
                }
                else {
                    replaceNode = Shaper.parse(Fmt('__op_set({0}, $, String($), $)', __op));
                }
                Shaper.replace(replaceNode, expr1, expr2, v);
            }
            else {
                throw new Error("replace: invalid ASSIGN form");
            }
        }
//         else if (node.type === tkn.EQ) {
//             error(node, "== used without /*@loose*/ annotation, did you mean === ?\n  Replace with === for strict equal or add annotation if loose equal with type-coercion was intended.");
//             return undefined;
//         }
//         else if (node.type === tkn.NE) {
//             error(node, "!= used without /*@loose*/ annotation, did you mean !== ?\n  Replace with !== for strict not-equal or add annotation if loose not-equal with type-coercion was intended.");
//             return undefined;
//         }
        else {
            // no-op
            return undefined;
        }
        ref.set(replaceNode);
        return replaceNode;
    }
    return Shaper.traverse(root, {pre: checkerPre, post: checkerPost});
});

Annotater(/\/\*+\s*@loose\s*\*+\//, function(node, match) {
    node.loose = true;
});

    return Shaper.get("restricter");
});
