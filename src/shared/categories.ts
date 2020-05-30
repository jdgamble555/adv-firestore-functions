import * as admin from 'firebase-admin';
try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
const db = admin.firestore();

/**
 * Count number of documents in a category
 * @param change
 * @param context
 * @param counter
 * @param pathField
 * @param arrayField
 * @param field
 * @param catCol
 */
export async function catDocCounter(
  change: any,
  context: any,
  counter: string = '',
  pathField = 'catPath',
  arrayField = 'catArray',
  field = 'category',
  catCol = 'categories',
) {
  // simplify event types
  const createDoc = change.after.exists && !change.before.exists;
  const deleteDoc = change.before.exists && !change.after.exists;
  const shiftDoc = createDoc || deleteDoc;
  if (!shiftDoc) {
    return null;
  }
  // simplify input data
  const after: any = change.after.exists ? change.after.data() : null;
  const before: any = change.before.exists ? change.before.data() : null;

  // category field
  const category = after ? after[field] : before[field];

  // collection name
  const colId = context.resource.name.split('/')[5];

  if (!counter) {
    counter = colId + 'Count';
  }
  const { queryCounter } = require('./counters');

  // fieldCount on categoriesDoc(s)
  let _category = category;
  while (_category !== '') {
    // get category document on each parent doc
    const catSearch = db.collection(catCol).where(pathField, '==', _category);
    const catSnap = await catSearch.get();
    const catRef = db.doc(`${catCol}/${catSnap.docs[0].id}`);

    // get cat query and update it
    const catsQuery = db.collection(colId).where(arrayField, 'array-contains', _category);
    await queryCounter(change, context, catsQuery, catRef, counter);

    // get parent
    _category = _category.split('/').slice(0, -1).join('/');
  }
  return null;
}
/**
 * Count number of subcategories in a category
 * @param change
 * @param context
 * @param counter
 * @param parentField
 * @param pathField
 */
export async function subCatCounter(
  change: any,
  context: any,
  counter: string = '',
  parentField = 'parent',
  pathField = 'catPath',
) {
  // simplify event types
  const createDoc = change.after.exists && !change.before.exists;
  const updateDoc = change.before.exists && change.after.exists;
  const writeDoc = createDoc || updateDoc;

  // simplify input data
  const after: any = change.after.exists ? change.after.data() : null;
  const before: any = change.before.exists ? change.before.data() : null;

  // collection name
  const colId = context.resource.name.split('/')[5];

  // get category variables
  const parent = writeDoc ? after[parentField] : before[parentField];

  if (!counter) {
    counter = colId + 'Count';
  }
  const { queryCounter } = require('./counters');

  let _category = parent;
  while (_category !== '') {
    // get parent category doc
    const catSearch = db.collection(colId).where(pathField, '==', _category);
    const catSnap = await catSearch.get();
    const catRef = db.doc(`${colId}/${catSnap.docs[0].id}`);

    // get cat query and update it
    const catsQuery = db.collection(colId).where('parent', '==', _category);
    console.log('Updating subcategory count on ', _category, ' doc');
    await queryCounter(change, context, catsQuery, catRef, counter);

    // get parent
    _category = _category.split('/').slice(0, -1).join('/');
  }
  return null;
}
