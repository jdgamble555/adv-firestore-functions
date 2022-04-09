import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { queryCounter } from './counters';
import { DocumentSnapshot } from 'firebase-admin/firestore';
try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
const db = admin.firestore();

type CounterDocumentData = { [field: string]: string };

/**
 * Count number of documents in a category
 * @param change - change ref
 * @param context - context event
 * @param counter - counter field name, default colCount
 * @param pathField - default catPath
 * @param arrayField - default catArray
 * @param field - default 'category'
 * @param catCol - default 'categories'
 */
export async function catDocCounter(
  change: functions.Change<DocumentSnapshot<CounterDocumentData>>,
  context: functions.EventContext,
  counter = '',
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
  const after = change.after.exists ? change.after.data() : null;
  const before = change.before.exists ? change.before.data() : null;

  // category field
  const category = after ? after[field] : before?.[field];

  if (category === null || category === undefined) {
    return null;
  }

  // collection name
  const collectionId = context.resource.name.split('/')[5];

  if (!counter) {
    counter = collectionId + 'Count';
  }

  // fieldCount on categoriesDoc(s)
  let _category = category;
  while (_category !== '') {
    // get category document on each parent doc
    const catSearch = db.collection(catCol).where(pathField, '==', _category);
    const catSnap = await catSearch.get();
    const catRef = db.doc(`${catCol}/${catSnap.docs[0].id}`);

    // get cat query and update it
    const catsQuery = db.collection(collectionId).where(arrayField, 'array-contains', _category);
    await queryCounter(change, context, catsQuery, catRef, counter);

    // get parent
    _category = _category.split('/').slice(0, -1).join('/');
  }
  return null;
}
/**
 * Count number of subcategories in a category
 * @param change - change ref
 * @param context - event context
 * @param counter - default catCount
 * @param parentField - parent category field name
 * @param pathField - default catPath
 */
export async function subCatCounter(
  change: functions.Change<DocumentSnapshot<CounterDocumentData>>,
  context: functions.EventContext,
  counter = '',
  parentField = 'parent',
  pathField = 'catPath',
) {
  // simplify event types
  const createDoc = change.after.exists && !change.before.exists;
  const updateDoc = change.before.exists && change.after.exists;
  const writeDoc = createDoc || updateDoc;

  // simplify input data
  const after = change.after.exists ? change.after.data() : null;
  const before = change.before.exists ? change.before.data() : null;

  // collection name
  const collectionId = context.resource.name.split('/')[5];

  // get category variables
  const parent = writeDoc ? after?.[parentField] : before?.[parentField];

  if (parent === null || parent === undefined) {
    return null;
  }

  if (!counter) {
    counter = collectionId + 'Count';
  }

  let _category = parent;
  while (_category !== '') {
    // get parent category doc
    const catSearch = db.collection(collectionId).where(pathField, '==', _category);
    const catSnap = await catSearch.get();
    const catRef = db.doc(`${collectionId}/${catSnap.docs[0].id}`);

    // get cat query and update it
    const catsQuery = db.collection(collectionId).where('parent', '==', _category);
    console.log('Updating subcategory count on ', _category, ' doc');
    await queryCounter(change, context, catsQuery, catRef, counter);

    // get parent
    _category = _category.split('/').slice(0, -1).join('/');
  }
  return null;
}
