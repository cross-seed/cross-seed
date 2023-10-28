/**
 * Zod validation schemas for config.js.
 *
 * All validate functions accept value for configs setting
 */

import { z } from "zod";
import { Action, LinkType, MatchMode } from "./constants.js";
import { existsSync } from "fs";

/**
 * VALIDATION_SCHEMA is just a object of all the zod schemas
 * each are named after what they are intended to validate
 */
export const VALIDATION_SCHEMA = {
	URL: z.union([z.string(), z.array(z.string())]).refine(
		(values) => {
			const validateUrl = (url) => {
				try {
					new URL(url);
					return true;
				} catch (error) {
					return false;
				}
			};

			if (Array.isArray(values)) {
				return values.every(
					(url) => typeof url === "string" && validateUrl(url)
				);
			} else {
				return typeof values === "string" && validateUrl(values);
			}
		},
		{
			message: "invalid URL",
		}
	),
	PATH: z.union([z.string(), z.array(z.string())]).refine(
		(values) => {
			const validatePath = (value) => {
				if (typeof value !== "string" || !existsSync(value)) {
					return false;
				}
				return true;
			};

			if (Array.isArray(values)) {
				return values.every(validatePath);
			} else {
				return validatePath(values);
			}
		},
		{
			message: "one or more paths do not exist on the filesystem",
		}
	),
	BOOLEAN: z
		.boolean()
		.refine((value) => value !== undefined && value !== null, {
			message: "value must be a defined boolean (true or false)",
		}),
	PORT: z.number().refine((value) => value >= 1 && value <= 65535, {
		message: "port must be a number between 1 and 65535",
	}),
	NUMBER: z.union([z.number(), z.undefined()]).refine(
		(value) => {
			return typeof value === "number" || value === undefined;
		},
		{
			message: "value must be a number or undefined",
		}
	),
	DELAY: z.number().refine((value) => value >= 1 && value <= 1000, {
		message:
			"delay is in seconds, >1000 implies you think it's milliseconds",
	}),
	ACTION: z
		.string()
		.refine((value) => value === Action.SAVE || value === Action.INJECT, {
			message: `value must be either '${Action.SAVE}' or '${Action.INJECT}'`,
		}),
	MATCHMODE: z
		.enum([MatchMode.SAFE, MatchMode.RISKY])
		.refine(
			(value) => value === MatchMode.RISKY || value === MatchMode.SAFE,
			{
				message: `value must be either '${MatchMode.RISKY}' or '${MatchMode.SAFE}'`,
			}
		),
	LINKTYPE: z
		.enum([LinkType.SYMLINK, LinkType.HARDLINK])
		.refine(
			(value) =>
				value === LinkType.HARDLINK || value === LinkType.SYMLINK,
			{
				message: `value must be either '${LinkType.HARDLINK}' or '${LinkType.SYMLINK}'`,
			}
		),
	STRING: z
		.string()
		.min(1, { message: "value must have at least 1 character" })
		.max(24, { message: "value can have a max of 24 characters" }),
	FUZZY: z.number().refine((value) => value > 0 && value < 1, {
		message: "must be a decimal percentage greater than 0 and less than 1",
	}),
	MS: z.number().refine(
		(value) => {
			return value !== undefined;
		},
		{
			message:
				"value must be in Vercel's 'ms' time format (e.g., '1d 2h 3m 4s')",
		}
	),
};

/**
 * validation for URL(s) in a string or array
 */
export function validateUrls(value) {
	try {
		VALIDATION_SCHEMA.URL.parse(value);
	} catch (error) {
		console.log(error.message);
	}
}

/**
 * validation for path's existance on the fs
 * accepts arrays or strings
 */

export function validatePaths(value) {
	try {
		VALIDATION_SCHEMA.PATH.parse(value);
	} catch (error) {
		console.log(error.message);
	}
}

/**
 *  Boolean validation.
 */
export function validateBoolean(value) {
	try {
		VALIDATION_SCHEMA.BOOLEAN.parse(value);
	} catch (error) {
		console.log(error.message);
	}
}

/**
 * Port (numeral) validation. 1-65535
 */
export function validatePort(value) {
	try {
		VALIDATION_SCHEMA.PORT.parse(value);
	} catch (error) {
		console.log(error.message);
	}
}

/**
 * Delay validation, assume >1000 means they think its milliseconds
 * Anything that high is stupid to have set as delay anyway.
 */
export function validateDelay(value) {
	try {
		VALIDATION_SCHEMA.DELAY.parse(value);
	} catch (error) {
		console.log(error.message);
	}
}
/**
 * action validation, either Action.SAVE or Action.INJECT
 */

export function validateAction(value) {
	try {
		VALIDATION_SCHEMA.ACTION.parse(value);
	} catch (error) {
		console.log(error.message);
	}
}

/**
 * matchMode validation, either MatchMode.RISKY or MatchMode.SAFE
 */

export function validateMatchMode(value) {
	try {
		VALIDATION_SCHEMA.MATCHMODE.parse(value);
	} catch (error) {
		console.log(error.message);
	}
}

/**
 * linkType validation, either LinkType.HARDLINK or LinkType.SYMLINK
 */
export function validateLinkType(value) {
	try {
		VALIDATION_SCHEMA.LINKTYPE.parse(value);
	} catch (error) {
		console.log(error.message);
	}
}

/**
 * Simple string validation, max 24 characters (dataCategory)
 */
export function validateString(value) {
	try {
		VALIDATION_SCHEMA.STRING.parse(value);
	} catch (error) {
		console.log(error.message);
	}
}

/**
 * fuzzyThreshold validation. Must be a percentage in decimal notation.
 */

export function validateFuzzyThreshold(value) {
	try {
		VALIDATION_SCHEMA.FUZZY.parse(value);
	} catch (error) {
		console.log(error.message);
	}
}
