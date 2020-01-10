import {castArray} from 'lodash';
import {Model, QueryBuilder, ColumnRef, OrderByDirection, ColumnRefOrOrderByDescriptor, Page} from 'objection';
import {serializeCursor, deserializeCursor} from './lib/serialize';
import {columnToProperty} from './lib/convert';
import {stringifyObjectionBuilder, getCoalescedOp, lockStatement} from './lib/utils';

export interface Options {
	limit: number;
	pageInfo: {
		total: boolean;
		remaining: boolean;
		remainingBefore: boolean;
		remainingAfter: boolean;
		hasMore: boolean;
		hasNext: boolean;
		hasPrevious: boolean;
	};
}

export interface InputOptions {
	limit?: number;
	pageInfo?: Partial<Options['pageInfo']>;
}

export interface CursorPageResultType<R = any> {
	results: R;
	pageInfo: PageInfo;
}

export interface PageInfo {
	total: number;
	remaining: number;
	remainingBefore: number;
	remainingAfter: number;
	hasMore: boolean;
	hasNext: boolean;
	hasPrevious: boolean;
	next: string;
	previous: string;
}

export interface WhereStmtOp {
	col: ColumnRef;
	prop: string;
	dir: string;
}

const FLAG_ONBUILD = '__cursor_flag_onBuild';
const FLAG_ONBUILD_ORDERBY = '__cursor_flag_onBuild_orderBy';
const FLAG_ORIGINAL_BUILDER = '__cursor_flag_original_builder';
const FLAG_CURSORPAGE = '__cursor_flag_cursorPage';
const FLAG_ORDERBY = '__cursor_flag_orderBy';
const FLAG_ORDERBYCOALESCE = '__cursor_flag_orderByCoalesce';

const DATA_ORDERBY = '__cursor_data_orderBy';
const DATA_ORDERBYCOALESCE = '__cursor_data_orderByCoalesce';
const DATA_ORIGQUERY = '__cursor_data_originalQueryBuilder';

class CursorQueryBuilder<M extends Model, R = M[]> extends QueryBuilder<M, R> {
	public ArrayQueryBuilderType!: CursorQueryBuilder<M, M[]>;
	public SingleQueryBuilderType!: CursorQueryBuilder<M, M>;
	public NumberQueryBuilderType!: CursorQueryBuilder<M, number>;
	public PageQueryBuilderType!: CursorQueryBuilder<M, Page<M>>;

	public orderBy = (columns: ColumnRef | ColumnRefOrOrderByDescriptor[], dir: OrderByDirection = 'asc') => {
		if (Array.isArray(columns)) {
			let builder = this;

			for (const descriptor of columns) {
				const column = (descriptor as any).column || descriptor;
				const order = (descriptor as any).order || 'asc';

				builder = builder.orderBy(column, order);
			}

			return builder;
		}

		const col = columns;

		if (this.context()[FLAG_ONBUILD] || this.context()[FLAG_ONBUILD_ORDERBY]) {
			// orderBy was called from an onBuild handler
			return super.orderBy(col, dir);
		}

		const orderByData = this.context()[DATA_ORDERBY] || [];
		this.mergeContext({
			[FLAG_ORDERBY]: true,
			[DATA_ORDERBY]: [...orderByData, {col, dir}]
		});

		return this
			.onBuild(builder => {
				// If `cursorPage` was not called, add orderBy statements here
				if (!builder.context()[FLAG_CURSORPAGE]) {
					this._buildOrderBy(builder);
				}
			});
	}

	public orderByCoalesce(col: ColumnRef, dir: OrderByDirection = 'asc', coalesceValues: ColumnRef | ColumnRef[] = ['']) {
		const orderByData = this.context()[DATA_ORDERBY] || [];

		this.mergeContext({
			[FLAG_ORDERBYCOALESCE]: true,
			[DATA_ORDERBY]: [...orderByData, {col, dir}],
			[DATA_ORDERBYCOALESCE]: Object.assign({}, this.context()[DATA_ORDERBYCOALESCE], {
				[columnToProperty(this.modelClass(), col)]: castArray(coalesceValues)
			})
		});

		return this
			.onBuild(builder => {
				// If `orderBy` or `cursorPage` was not called, add orderBy statements here
				if (!builder.context()[FLAG_ORDERBY] && !builder.context()[FLAG_CURSORPAGE]) {
					this._buildOrderBy(builder);
				}
			});
	}

	public cursorPage(cursor?: string, before: boolean = false) {
		const query = this
			.mergeContext({[FLAG_CURSORPAGE]: true})
			.onBuild(builder => lockStatement(builder, FLAG_ONBUILD, () => {
				return this._buildCursor(builder, cursor, before);
			}))
			.runAfter((result, builder) => {
				const results = castArray(result) as R extends any[] ? R : R[];

				// We want to always return results in the same order; as if turning pages in a book
				if (before) {
					results.reverse();
				}

				const item = this._getPartialCursorItem(cursor);

				/* When we reach end while going forward, save the last element of the last page, but discard
				* first element of last page. If we try to go forward, we get an empty result, because
				* there are no elements after the last one. If we go back from there, we get results for
				* the last page. The opposite is true when going backward from the first page.
				*/
				const first = results.length > 0 ? results[0] : (before ? item : null);
				const last = results.length > 0 ? results[results.length - 1] : (before ? null : item);
				const orderByOps = this._getOrderByOperations(before);

				return this._getAdditionalPageInfo(results, builder, before)
					.then(additionalPageInfo => ({
						results,
						pageInfo: Object.assign(additionalPageInfo, {
							next: serializeCursor(orderByOps, last),
							previous: serializeCursor(orderByOps, first)
						})
					}));
			});

		type BuilderType = R extends CursorPageResultType
			? CursorQueryBuilder<M, R>
			: CursorQueryBuilder<M, CursorPageResultType<R>>;

		return query as unknown as BuilderType;
	}

	public nextCursorPage(cursor: string) {
		return this.cursorPage(cursor, false);
	}

	public previousCursorPage(cursor: string) {
		return this.cursorPage(cursor, true);
	}

	private options() {
		const cls = this.modelClass() as any;
		return cls.options as Options;
	}

	private _getPartialCursorItem(cursor?: string) {
		// Direction doesn't matter here, since we only want to know if a column exists
		const orderByOps = this._getOrderByOperations();

		// Get partial item from cursor
		return deserializeCursor(orderByOps, cursor);
	}

	private _getOrderByOperations(before: boolean = false) {
		const orderByData: Array<{col: string, dir: OrderByDirection}> = this.context()[DATA_ORDERBY] || [];

		return orderByData.map(({col, dir = 'asc'}) => ({
			col,
			prop: columnToProperty(this.modelClass(), col),
			// If going backward: asc => desc, desc => asc
			dir: before === (dir.toLowerCase() === 'asc') ? 'desc' : 'asc'
		}));
	}

	private _addWhereStmts(builder: this, ops: WhereStmtOp[], item: any, composites: WhereStmtOp[] = []) {
		if (!item) {
			return;
		}

		if (ops.length === 0) {
			throw new Error('Invalid cursor');
		}

		const {col, val, dir} = getCoalescedOp(this, builder.context()[DATA_ORDERBYCOALESCE], ops[0], item);
		const comp = dir === 'asc' ? '>' : '<';

		if (ops.length === 1) {
			return builder.where(col, comp, val);
		}

		const self = this;
		composites = [ops[0], ...composites];

		builder.andWhere(function() {
			this.where(col, comp, val);
			this.orWhere(function() {
				self._addWhereComposites(this, composites, item);
				this.andWhere(function() {
					// Add where statements recursively
					self._addWhereStmts(this, ops.slice(1), item, composites);
				});
			});
		});
	}

	private _addWhereComposites(builder: this, composites: WhereStmtOp[], item: any) {
		const orderByCoalesceData: {[k: string]: ColumnRef[]} = builder.context()[DATA_ORDERBYCOALESCE];
		for (const op of composites) {
			const {col, val} = getCoalescedOp(this, orderByCoalesceData, op, item);
			builder.andWhere(col, val);
		}
	}

	private _buildOrderBy(builder: this) {
		lockStatement(builder, FLAG_ONBUILD_ORDERBY, () => {
			const ctx = builder.context();
			const model = this.modelClass();
			const orderByData = ctx[DATA_ORDERBY] || [];
			const orderByCoalesceData: {[k: string]: ColumnRef[]} = ctx[DATA_ORDERBYCOALESCE];

			for (const {col, dir} of orderByData) {
				const coalesceValues = orderByCoalesceData
					? orderByCoalesceData[columnToProperty(model, col)]
					: null;

				if (coalesceValues) {
					const mappedCoalesce = coalesceValues.map(val => stringifyObjectionBuilder(builder, val));
					const colStr = stringifyObjectionBuilder(builder, col);

					const coalesceBindingsStr = coalesceValues.map(() => '?').join(', ');

					builder.orderBy(
						model.raw(`COALESCE(??, ${coalesceBindingsStr})`, [colStr].concat(mappedCoalesce)),
						dir
					);
				} else {
					builder.orderBy(col, dir);
				}
			}
		});
	}

	private _buildCursor(builder: this, cursor?: string, before: boolean = false) {
		// Save current builder (before where statements) for pageInfo (total, remaining, etc.)
		builder.mergeContext({
			[DATA_ORIGQUERY]: builder.clone().mergeContext({[FLAG_ORIGINAL_BUILDER]: true})
		});

		const orderByOps = this._getOrderByOperations(before);
		const item = this._getPartialCursorItem(cursor);

		this._buildOrderBy(builder);
		this._addWhereStmts(builder, orderByOps, item);

		if (!(builder as any).has(/limit/)) {
			builder.limit(this.options().limit);
		}

		// Swap orderBy directions when going backward
		if (before) {
			(builder as any).forEachOperation(/orderBy/, (op: {args: any[]}) => {
				op.args[1] = op.args[1] === 'asc' ? 'desc' : 'asc';
			});
		}
	}

	private _getAdditionalPageInfo(models: R[], builder: this, before: boolean) {
		const pageInfo: Partial<PageInfo> = {};

		// Check if at least one given option is enabled
		const isEnabled = (opts: Array<keyof Options['pageInfo']>) => opts.some(opt => this.options().pageInfo[opt]);
		const setIfEnabled = <K extends keyof Options['pageInfo'], V extends PageInfo[K]>(opt: K, val: V) => {
			pageInfo[opt] = this.options().pageInfo[opt] ? val : undefined;
		};

		let total: number;

		return Promise.resolve()
			.then(() => {
				if (isEnabled(['total', 'hasNext', 'hasPrevious', 'remainingBefore', 'remainingAfter'])) {
					const origBuilder: this = builder.context()[DATA_ORIGQUERY];
					return origBuilder.resultSize().then(rs => {
						total = rs;
						setIfEnabled('total', total);
					});
				}
			})
			.then(() => {
				if (isEnabled(['hasMore', 'hasNext', 'hasPrevious', 'remaining', 'remainingBefore', 'remainingAfter'])) {
					return this.clone().resultSize().then(rs => {
						const remaining = rs - models.length;
						setIfEnabled('remaining', remaining);
						setIfEnabled('remainingBefore', before ? remaining : total - rs);
						setIfEnabled('remainingAfter', before ? total - rs : remaining);
						setIfEnabled('hasMore', remaining > 0);
						setIfEnabled('hasPrevious', (before && remaining > 0) || (!before && total - rs > 0));
						setIfEnabled('hasNext', (!before && remaining > 0) || (before && total - rs > 0));
					});
				}
			})
			.then(() => pageInfo);
	}
}

export default CursorQueryBuilder;
