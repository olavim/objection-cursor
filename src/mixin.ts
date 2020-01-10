import {Model} from 'objection';
import CursorQueryBuilder, {Options} from './query-builder';

export type AnyConstructor<A = object> = new (...input: any[]) => A;

declare module 'knex';

interface CursorInstance<T extends AnyConstructor<Model>> {
	QueryBuilderType: CursorQueryBuilder<this & InstanceType<T>, this[]>;
}

interface Cursor<T extends AnyConstructor<Model>> {
	options: Options;
	QueryBuilder: typeof CursorQueryBuilder;
	new (...args: any[]): CursorInstance<T>;
}

export type CursorMixin<T extends AnyConstructor<Model>> = Cursor<T> & T;

export default function mixin(options: Options) {
	return function <T extends AnyConstructor<Model>>(Base: T): CursorMixin<T> {
		return class extends Base {
			public static options = options;
			public static QueryBuilder = CursorQueryBuilder;
			public QueryBuilderType!: CursorQueryBuilder<this, this[]>;
		} as CursorMixin<T>;
	};
}
