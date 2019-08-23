class TypeSerializer {
	constructor(typeName) {
		this.typeName = typeName;
	}

	getPrefix() {
		return `(${this.typeName})`;
	}

	test() {
		return false;
	}
}

class DateSerializer extends TypeSerializer {
	constructor() {
		super('date');
	}

	test(value) {
		return value instanceof Date;
	}

	serialize(value) {
		return value.toISOString();
	}

	deserialize(value) {
		return new Date(value);
	}
}

class JSONSerializer extends TypeSerializer {
	constructor() {
		super('json');
	}

	test() {
		// Any type can be stringified
		return true;
	}

	serialize(value) {
		return JSON.stringify(value);
	}

	deserialize(value) {
		return JSON.parse(value);
	}
}

const serializers = [
	new DateSerializer(),
	new JSONSerializer()
];

function serializeValue(value) {
	const serializer = serializers.find(s => s.test(value));
	return `${serializer.getPrefix()}${serializer.serialize(value)}`;
}

function deserializeString(str) {
	const matches = str.match(/\((.*?)\)(.*)/);

	if (!matches) {
		throw new TypeError('Invalid cursor');
	}

	const typeName = matches[1];
	const serializedValue = matches[2];
	const serializer = serializers.find(s => s.typeName === typeName);
	return serializer.deserialize(serializedValue);
}

module.exports = {serializeValue, deserializeString};
