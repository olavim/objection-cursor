class TypeSerializer {
	public typeName: string;

	constructor(typeName: string) {
		this.typeName = typeName;
	}

	public getPrefix() {
		return `(${this.typeName})`;
	}

	public test(...args: any[]) {
		return false;
	}
}

class DateSerializer extends TypeSerializer {
	constructor() {
		super('date');
	}

	public test(value: any) {
		return value instanceof Date;
	}

	public serialize(value: Date) {
		return value.toISOString();
	}

	public deserialize(value: string) {
		return new Date(value);
	}
}

class JSONSerializer extends TypeSerializer {
	constructor() {
		super('json');
	}

	public test() {
		// Any type can be stringified
		return true;
	}

	public serialize(value: any) {
		return JSON.stringify(value);
	}

	public deserialize(value: string) {
		return JSON.parse(value);
	}
}

const serializers = [
	new DateSerializer(),
	new JSONSerializer()
];

export function serializeValue(value: any) {
	const serializer = serializers.find(s => s.test(value));
	return `${serializer!.getPrefix()}${serializer!.serialize(value)}`;
}

export function deserializeString(str: string) {
	const matches = str.match(/\((.*?)\)(.*)/);

	if (!matches) {
		throw new TypeError('Invalid cursor');
	}

	const typeName = matches[1];
	const serializedValue = matches[2];
	const serializer = serializers.find(s => s.typeName === typeName);
	return serializer!.deserialize(serializedValue);
}
