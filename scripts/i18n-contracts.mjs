import { parse, TYPE } from "@formatjs/icu-messageformat-parser";

const mergeArgument = (argumentsByName, name, type, label) => {
  const previous = argumentsByName.get(name);
  if (previous && previous !== type)
    throw new Error(`${label} uses {${name}} as both ${previous} and ${type}.`);
  argumentsByName.set(name, type);
};

/** Parses one ICU message and returns its stable argument contract. */
export const messageArguments = (message, label = "message") => {
  let elements;
  try {
    elements = parse(message, { captureLocation: false, ignoreTag: true });
  } catch (error) {
    throw new Error(`${label} has invalid ICU syntax: ${error.message}`);
  }
  const argumentsByName = new Map();
  const visit = (children) => {
    for (const element of children) {
      if (element.type === TYPE.literal || element.type === TYPE.pound)
        continue;
      if (element.type === TYPE.tag)
        throw new Error(`${label} uses unsupported ICU rich-text tags.`);
      const type =
        element.type === TYPE.number || element.type === TYPE.plural
          ? "number"
          : element.type === TYPE.select
            ? "string"
            : element.type === TYPE.date || element.type === TYPE.time
              ? "string | number"
              : "string | number | boolean";
      mergeArgument(argumentsByName, element.value, type, label);
      if (element.type === TYPE.select || element.type === TYPE.plural)
        for (const option of Object.values(element.options))
          visit(option.value);
    }
  };
  visit(elements);
  return Object.fromEntries(
    [...argumentsByName.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
};

export const sameMessageArguments = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);
