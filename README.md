# objection-cursor

An [Objection.js](https://vincit.github.io/objection.js) plugin for cursor-based pagination, AKA keyset pagination.

Using offsets for pagination is a widely popular technique. Clients tell the number of results they want per page, and the page number they want to return results from. While easy to implement and use, offsets come with a drawback: when items are written to the database at a high frequency, offset based pagination becomes unreliable. For example, if we fetch a page with 10 rows, and then 10 rows are added, fetching the second page might contain the same rows as the first page.

Cursor-based pagination works by returning a pointer to a row in the database. Fetching the next/previous page will then return items after/before the given pointer. While reliable, this technique comes with a few drawbacks itself:

- The cursor must be based on a unique column (or columns)
- The concept of pages is lost, and thus you cannot jump to a specific one

Cursor pagination is used by companies such as Twitter, Facebook and Slack, and goes well with infinite scroll elements in general.

# Installation

```
$ npm install objection-cursor
```

# Usage

#### Mixin

```js
const Model = require('objection').Model;
const cursorMixin = require('objection-cursor');

// Set options
const cursor = cursorMixin({limit: 10});

class Movie extends cursor(Model) {
  ...
}

// Options are not required
class Car extends cursorMixin(Model) {
  ...
}
```

#### Quick Start

```js
const query = Movie.query()
  // Strict ordering is required
  .orderBy('title')
  .orderBy('author')
  .limit(10);

query.clone().cursorPage()
  .then(result => {
    // Rows 1-10
    console.log(result.results);
    return query.clone().cursorPage(result.pageInfo.next);
  })
  .then(result => {
    // Rows 11-20
    console.log(result.results);
    return query.clone().previousCursorPage(result.pageInfo.previous);
  })
  .then(result => {
    // Rows 1-10
    console.log(result.results);
  });
```

You have the option of returning page results as plain database row objects (as in above example), or _nodes_ where each result is associated with a cursor of its own, or both.

```js
const Model = require('objection').Model;
const cursorMixin = require('objection-cursor');

// Nodes are not returned by default, so you need to enable them
const cursor = cursorMixin({nodes: true});

class Movie extends cursor(Model) {
  ...
}

const query = Movie.query()
  .orderBy('title')
  .orderBy('author')
  .limit(10);

query.clone().cursorPage()
  .then(result => {
    // Rows 1-10 with associated cursors
    console.log(result.nodes);

    // Let's take the second node
    const node = result.nodes[1];

    // result.nodes[1].data is equivalent to result.results[1]
    console.log(result.nodes[1].data);

    // You can get results before/after this row by using node.cursor
    return query.clone().cursorPage(node.cursor);
  });
```

Passing a [reference builder](https://vincit.github.io/objection.js/#referencebuilder) to `orderBy` is supported. [Raw queries](https://vincit.github.io/objection.js/#raw-queries), however, are not.

```js
const query = Movie.query()
  .joinEager('director')
  .orderBy(ref('director.name'))
  // Order by a JSON field of an eagerly joined relation
  .orderBy(ref('director.born:time').castText())
  .orderBy('id')
  ...
```

That doesn't mean raw queries aren't supported at all. You do need to use a special function for this though, called `orderByExplicit` (because `orderByRaw` was taken...)

```js
const {raw} = require('objection');

const query = Movie.query()

  // Coalesce null values into empty string
  .orderByExplicit(raw('COALESCE(??, ?)', ['alt_title', '']))

  // Same as above
  .orderByExplicit(raw('COALESCE(??, ?)', ['alt_title', '']), 'asc')

  // Works with reference builders and strings
  .orderByExplicit(ref('details:completed').castText(), 'desc')

   // Reference builders can be used as part of raw queries
  .orderByExplicit(raw('COALESCE(??, ??, ?)', ['even_more_alt_title', ref('alt_title'), raw('?', '')]))

   // Sometimes you need to go deeper...
  .orderByExplicit(
    raw('CASE WHEN ?? IS NULL THEN ? ELSE ?? END', ['alt_title', '', 'alt_title'])
    'asc',

    /* Since this is a cursor plugin, we need to compare actual values that are encoded in the cursor.
     * `orderByExplicit` needs to know how to compare a column to a value, which isn't easy to guess
     * when you're throwing raw queries at it. By default the callback's return value is similar to the
     * column raw query, except the first binding is changed to the value. If this guess would be incorrect,
     * you need to specify the compared value manually.
     */
    value => value || ''
  )

   // And deeper...
  .orderByExplicit(
    raw('CONCAT(??, ??)', ['id', 'title'])
    'asc',

    /* You can return a string, ReferenceBuilder, or a RawBuilder in the callback. This is useful
     * when you need to use values from other columns.
     */
    value => raw('CONCAT(??, ?)', ['id', value]),

    /* By default the first binding in the column raw query (after column name mappers) is used to
     * access the relevant value from results. For example, in this case we say value = result['title']
     * instead of value = result['id'].
     */
    'title'
  )
  .orderBy('id')
  ...
```

Cursors ordered by nullable columns won't work out-of-the-box. For this reason the mixin also introduces an `orderByCoalesce` method, which you can use to treat nulls as some other value for the sake of comparisons. Same as `orderBy`, `orderByCoalesce` supports reference builders, but not raw queries.

**Deprecated!** Use `orderByExplicit` instead.

```js
const query = Movie.query()
  .orderByCoalesce('alt_title', 'asc', '') // Coalesce null values into empty string
  .orderByCoalesce('alt_title', 'asc') // Same as above
  .orderByCoalesce('alt_title', 'asc', [null, 'hello']) // First non-null value will be used
  .orderByCoalesce(ref('details:completed').castText(), 'desc') // Works with refs
   // Reference builders and raw queries can be coalesced to
  .orderByCoalesce('even_more_alt_title', 'asc', [ref('alt_title'), raw('?', '')])
  .orderBy('id')
  ...
```

# API

## `Plugin`

### `cursor(options | Model)`

You can setup the mixin with or without options.

Example (with options):

```js
const Model = require('objection').Model;
const cursorMixin = require('objection-cursor');

const cursor = cursorMixin({
  limit: 10,
  pageInfo: {
    total: true,
    hasNext: true
  }
});

class Movie extends cursor(Model) {
  ...
}

Movie.query()
  .orderBy('id')
  .cursorPage()
  .then(res => {
    console.log(res.results.length) // 10
    console.log(res.pageInfo.total) // Some number
    console.log(res.pageInfo.hasNext) // true

    console.log(res.pageInfo.remaining) // undefined
    console.log(res.pageInfo.hasPrevious) // undefined
  });
```

Example (without options):

```js
const Model = require('objection').Model;
const cursorMixin = require('objection-cursor');

class Movie extends cursorMixin(Model) {
  ...
}
```

## `CursorQueryBuilder`

### `cursorPage([cursor, [before]])`

- `cursor` - A URL-safe string used to determine after/before which element items should be returned.
- `before` - When `true`, return items before the one specified in the cursor. Use this to "go back".
  - Default: `false`.

**Response format:**

```js
{
  results: // Page results
  nodes: // Page results where each result also has an associated cursor
  pageInfo: {
    next: // Provide this in the next `cursorPage` call to fetch items after current results.
    previous: // Provide this in the next `previousCursorPage` call to fetch items before current results.

    hasMore: // If `options.pageInfo.hasMore` is true.
    hasNext: // If `options.pageInfo.hasNext` is true.
    hasPrevious: // If `options.pageInfo.hasPrevious` is true.
    remaining: // If `options.pageInfo.remaining` is true. Number of items remaining (after or before `results`).
    remainingBefore: // If `options.pageInfo.remainingBefore` is true. Number of items remaining before `results`.
    remainingAfter: // If `options.pageInfo.remainingAfter` is true. Number of items remaining after `results`.
    total: // If `options.pageInfo.total` is true. Total number of available rows (without limit).
  }
}
```

### `nextCursorPage([cursor])`

Alias for `cursorPage`, with `before: false`.

### `previousCursorPage([cursor])`

Alias for `cursorPage`, with `before: true`.

### `orderByCoalesce(column, [direction, [values]])`

> **Deprecated**: use `orderByExplicit` instead.

Use this if you want to sort by a nullable column.

- `column` - Column to sort by.
- `direction` - Sort direction.
  - Default: `asc`
- `values` - Values to coalesce to. If column has a null value, treat it as the first non-null value in `values`. Can be one or many of: *string*, *number*, *ReferenceBuilder* or *RawQuery*.
  - Default: `['']`

### `orderByExplicit(column, [direction, [compareValue], [property]])`

Use this if you want to sort by a RawBuilder.

- `column` - Column to sort by. If this is _not_ a RawBuilder, `compareValue` and `property` will be ignored.
- `direction` - Sort direction.
  - Default: `asc`
- `compareValue` callback - Callback is called with a value, and should return one of *string*, *number*, *ReferenceBuilder* or *RawQuery*. The returned value will be compared against `column` when determining which row to show results before/after. See [this code comment](https://github.com/olavim/objection-cursor/blob/960a037f2d77d4578dab8c07320601b5a56a5b24/lib/query-builder/CursorQueryBuilder.js#L103) for more details.
- `property` - Values will be encoded inside cursors based on ordering, and for this reason `orderByExplicit` needs to know how to access the related value in the resulting objects. By default the first argument passed to the `column` raw builder will be used, but if for some reason this guess would be wrong, you need to specify here how to access the value.

#### When do I need to use `compareValue`?

Consider the following case, where we use a `CASE` statement instead of `COALESCE` to coalesce null values to empty strings

```js
Movie.query()
  .orderByExplicit(
    raw('CASE WHEN ?? IS NULL THEN ? ELSE ?? END', ['title', '', 'title']),
    'desc',
    value => value || ''
  )
  ...
```

In this case we have two reasons to use `compareValue`. One is that the column raw query uses the `title`
column reference more than once. The other is that we would need to modify the statement slightly, at least
in PostgreSQL's case (otherwise you would run into [this](https://github.com/jackc/pgx/issues/281)).

#### When do I need to use `property`?

When the property name in your result is different than the first binding in your column raw query. For example, if your model's result structure is something like

```js
{
  id: 1,
  title: 'Hello there',
  author: 'Somebody McSome'
}
```

and your query looks like

```js
Movie.query()
  .orderByExplicit(raw(`COALESCE(??, '')`, 'date'))
  ...
```

you would need to use the `property` argument, because there is no `date` property in the result. This might happen if you use [`$parseDatabaseJson`](https://vincit.github.io/objection.js/api/model/instance-methods.html#parsedatabasejson) in your model, for example. Below is an example of using `property` argument together with `$parseDatabaseJson`.

```js
class Movie extends cursor(Model) {
  $parseDatabaseJson(json) {
    json = super.$parseDatabaseJson(json);

    // Rename `title` to `newTitle`
    json.newTitle = json.title;
    delete json.title;

    return json;
  }
}

Movie.query()
  .orderByExplicit(raw(`COALESCE(??, '')`, 'title'), 'asc', 'newTitle')
  ....
```

#### When do I need to use both?

Basically when the column binding in your column raw query is not the first binding, or if criteria for needing to use both is met for some other reason (see the previous two subchapters). Consider the following example

```js
Movie.query()
  .orderByExplicit(
    raw('CONCAT(?::TEXT, ??)', ['the ', 'title']),
    'asc',
    val => raw('CONCAT(?::TEXT, ?::TEXT)', ['the ', val]),
    'title'
  )
  ...
```

Here we are concatenating `"the "` in front of the movie title. Here we need both `compareValue` and `property`, because `title` is not the first binding in the column raw query (instead `"the "` is).

# Options

Values shown are defaults.

```js
{
  limit: 50, // Default limit in all queries
  results: true, // Page results
  nodes: true, // Page results where each result also has an associated cursor
  pageInfo: {
    // When true, these values will be added to `pageInfo` in query response
    total: false, // Total amount of rows
    remaining: false, // Remaining amount of rows in *this* direction
    remainingBefore: false, // Remaining amount of rows before current results
    remainingAfter: false, // Remaining amount of rows after current results
    hasMore: false, // Are there more rows in this direction?
    hasNext: false, // Are there rows after current results?
    hasPrevious: false, // Are there rows before current results?
  }
}
```

### Notes

- `pageInfo.total` requires additional query (**A**)
- `pageInfo.remaining` requires additional query (**B**)
- `pageInfo.remainingBefore` requires additional queries (**A**, **B**)
- `pageInfo.remainingAfter` requires additional queries (**A**, **B**)
- `pageInfo.hasMore` requires additional query (**B**)
- `pageInfo.hasNext` requires additional queries (**A**, **B**)
- `pageInfo.hasPrevious` requires additional queries (**A**, **B**)

**`remaining` vs `remainingBefore` and `remainingAfter`:**

`remaining` only tells you the remaining results in the *current* direction and is therefore less descriptive as `remainingBefore` and `remainingAfter` combined. However, in cases where it's enough to know if there are "more" results, using only the `remaining` information will use one less query than using either of `remainingBefore` or `remainingAfter`. Similarly `hasMore` uses one less query than `hasPrevious`, and `hasNext`.

However, if `total` is used, then using `remaining` no longer gives you the benefit of using one less query.
