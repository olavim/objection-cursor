import {expect} from 'chai';

function keysetKeys(query) {
	const keys = [];
	query.forEachOperation(/orderBy/, op => {
		keys.push(op.args[3] || op.args[0]);
	});
	return keys;
}

function mapResults(query, results) {
	const keys = keysetKeys(query);
	return results.map(r => {
		return keys.map(k => r[k]).join(', ');
	});
}

// Test query on different page sizes by going from first to last page, and then back.
export default async function test(query, pageSizeRange) {
	const totalExpected = await query.clone();

	const pageSizes = [...Array(pageSizeRange[1] - pageSizeRange[0] + 1)].map((_, i) => i + pageSizeRange[0]);

	await Promise.all(
		pageSizes.map(async pageSize => {
			let cursor;

			for (let offset = 0; offset < totalExpected.length; offset += pageSize) {
				const end = Math.min(offset + pageSize, totalExpected.length);

				const {results, nodes, pageInfo} = await query.clone().limit(end - offset).cursorPage(cursor);

				const expected = mapResults(query, results);
				const actual = mapResults(query, totalExpected.slice(offset, end));
				const pageDisplay = `rows: ${offset} - ${end} / ${totalExpected.length}`;

				expect(results.length, pageDisplay).to.equal(end - offset);
				expect(nodes.map(n => n.data)).to.deep.equal(results);
				expect(pageInfo.total, pageDisplay).to.equal(totalExpected.length);
				expect(pageInfo.remaining, pageDisplay).to.equal(totalExpected.length - end);
				expect(pageInfo.remainingAfter, pageDisplay).to.equal(totalExpected.length - end);
				expect(pageInfo.remainingBefore, pageDisplay).to.equal(offset);
				expect(pageInfo.hasMore, pageDisplay).to.equal(end < totalExpected.length);
				expect(pageInfo.hasNext, pageDisplay).to.equal(end < totalExpected.length);
				expect(pageInfo.hasPrevious, pageDisplay).to.equal(offset > 0);
				expect(expected, pageDisplay).to.deep.equal(actual);

				cursor = pageInfo.next;
			}

			const resEnd = await query.clone().limit(5).cursorPage(cursor);
			expect(resEnd.results).to.deep.equal([]);

			cursor = resEnd.pageInfo.previous;

			for (let end = totalExpected.length; end >= 0; end -= pageSize) {
				const offset = Math.max(0, end - pageSize);

				const {results, nodes, pageInfo} = await query.clone().limit(end - offset).previousCursorPage(cursor);

				const expected = mapResults(query, results);
				const actual = mapResults(query, totalExpected.slice(offset, end));
				const pageDisplay = `rows: ${offset} - ${end} / ${totalExpected.length}`;

				expect(results.length, pageDisplay).to.equal(end - offset);
				expect(nodes.map(n => n.data)).to.deep.equal(results);
				expect(pageInfo.total, pageDisplay).to.equal(totalExpected.length);
				expect(pageInfo.remaining, pageDisplay).to.equal(offset);
				expect(pageInfo.remainingAfter, pageDisplay).to.equal(totalExpected.length - end);
				expect(pageInfo.remainingBefore, pageDisplay).to.equal(offset);
				expect(pageInfo.hasMore, pageDisplay).to.equal(offset > 0);
				expect(pageInfo.hasNext, pageDisplay).to.equal(end < totalExpected.length);
				expect(pageInfo.hasPrevious, pageDisplay).to.equal(offset > 0);
				expect(expected, pageDisplay).to.deep.equal(actual);

				cursor = pageInfo.previous;
			}

			const resStart = await query.clone().limit(5).previousCursorPage(cursor);
			expect(resStart.results).to.deep.equal([]);
		})
	);

	await testEdges(query);
}

async function testEdges(query) {
	const totalExpected = await query.clone();
	const firstPage = await query.clone().cursorPage();
	const numResults = firstPage.results.length;

	for (let i = 0; i < numResults; i++) {
		const page = await query.clone().cursorPage(firstPage.nodes[i].cursor);
		expect(page.results).to.deep.equal(totalExpected.slice(i + 1, numResults + i + 1));
		expect(page.nodes.map(n => n.data)).to.deep.equal(page.results);
		expect(page.pageInfo.total).to.equal(totalExpected.length);
		expect(page.pageInfo.remaining).to.equal(totalExpected.length - page.results.length - i - 1);
		expect(page.pageInfo.remainingAfter).to.equal(totalExpected.length - page.results.length - i - 1);
		expect(page.pageInfo.remainingBefore).to.equal(i + 1);
		expect(page.pageInfo.hasMore).to.equal(i + page.results.length + 1 < totalExpected.length);
		expect(page.pageInfo.hasNext).to.equal(i + page.results.length + 1 < totalExpected.length);
		expect(page.pageInfo.hasPrevious).to.equal(true);
	}

	for (let i = numResults - 1; i >= 0; i--) {
		const page = await query.clone().previousCursorPage(firstPage.nodes[i].cursor);
		expect(page.results).to.deep.equal(totalExpected.slice(0, i));
		expect(page.nodes.map(n => n.data)).to.deep.equal(page.results);
		expect(page.pageInfo.total).to.equal(totalExpected.length);
		expect(page.pageInfo.remaining).to.equal(0);
		expect(page.pageInfo.remainingAfter).to.equal(totalExpected.length - i);
		expect(page.pageInfo.remainingBefore).to.equal(0);
		expect(page.pageInfo.hasMore).to.equal(false);
		expect(page.pageInfo.hasNext).to.equal(numResults < totalExpected.length);
		expect(page.pageInfo.hasPrevious).to.equal(false);
	}
}