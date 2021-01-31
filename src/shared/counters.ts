import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
const db = admin.firestore();

/**
 * Runs the counter function
 * @param change - change ref
 * @param context - event context
 */
export async function colCounter(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  context: functions.EventContext,
  countersCol = '_counters',
) {
  // simplify event types
  const createDoc = change.after.exists && !change.before.exists;
  const deleteDoc = change.before.exists && !change.after.exists;
  const shiftDoc = createDoc || deleteDoc;
  if (!shiftDoc) {
    return null;
  }
  // get parent collection
  // TODO: will need to be edited for sub collections...
  const parentCol = context.resource.name.split('/').slice(0, -1).pop();
  // const parentDocId = context.resource.name.split('/').pop();

  console.log('Updating ', parentCol, ' counter');

  // check for sub collection
  const isSubCol = context.params.subDocId;

  const parentDoc = `${countersCol}/${parentCol}`;
  const countDoc = isSubCol ? `${parentDoc}/${context.params.docId}/${context.params.subColId}` : `${parentDoc}`;

  // collection references
  const countRef = db.doc(countDoc);
  const countSnap = await countRef.get();

  // increment size if doc exists
  if (countSnap.exists) {
    // createDoc or deleteDoc
    const n = createDoc ? 1 : -1;
    const i = admin.firestore.FieldValue.increment(n);

    return db
      .runTransaction(
        async (t: FirebaseFirestore.Transaction): Promise<any> => {
          // add event and update size
          return t.update(countRef, { count: i });
        },
      )
      .catch((e: any) => {
        console.log(e);
      });
    // otherwise count all docs in the collection and add size
  } else {
    const colRef = db.collection(change.after.ref.parent.path);
    return db
      .runTransaction(
        async (t: FirebaseFirestore.Transaction): Promise<any> => {
          // update size
          const colSnap = await t.get(colRef);
          return t.set(countRef, { count: colSnap.size });
        },
      )
      .catch((e: any) => {
        console.log(e);
      });
  }
}
/**
 * Adds a query counter to a doc
 * @param change - change ref
 * @param context - event context
 * @param queryRef - the query ref to count
 * @param countRef - the counter document ref
 * @param countName - the name of the counter on the counter document
 * @param del - boolean whether or not to delete the document
 * @param n - (1,-1)  1 for create, -1 for delete
 * @param check - whether or not to check for create or delete doc
 */
export async function queryCounter(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  context: functions.EventContext,
  queryRef: FirebaseFirestore.Query,
  countRef: FirebaseFirestore.DocumentReference,
  countName: string = '',
  del = 0,
  n = 0,
  check = true,
) {
  // simplify event types
  const createDoc = change.after.exists && !change.before.exists;
  const deleteDoc = change.before.exists && !change.after.exists;
  const shiftDoc = createDoc || deleteDoc;
  if (!shiftDoc && check) {
    return null;
  }
  // collection name
  const colId = context.resource.name.split('/')[5];

  if (!countName) {
    countName = colId + 'Count';
  }
  console.log('Updating ', countName, ' counter on ', countRef.path);

  // doc references
  const countSnap = await countRef.get();

  // increment size if field exists
  if (countSnap.get(countName)) {
    // createDoc or deleteDoc
    const _n = n !== 0 ? n : createDoc ? 1 : -1;
    const i = admin.firestore.FieldValue.increment(_n);

    // delete counter document if necessary
    if (countSnap.get(countName) === 1 && n === -1 && del === 1) {
      return countRef.delete();
    }
    return db
      .runTransaction(
        async (t: FirebaseFirestore.Transaction): Promise<any> => {
          // add event and update size
          return t.set(countRef, { [countName]: i }, { merge: true });
        },
      )
      .catch((e: any) => {
        console.log(e);
      });
    // otherwise count all docs in the collection and add size
  } else {
    return db
      .runTransaction(
        async (t: FirebaseFirestore.Transaction): Promise<any> => {
          // update size
          const colSnap = await t.get(queryRef);
          return t.set(countRef, { [countName]: colSnap.size }, { merge: true });
        },
      )
      .catch((e: any) => {
        console.log(e);
      });
  }
}
/**
 * Adds a condition counter to a doc
 * @param change - change ref
 * @param context - event context
 * @param field - where field path
 * @param operator - where operator
 * @param value - where value
 * @param countName - counter field name, default ${field}Count
 * @param countersCol - counter collection name, default _counters
 * @param del - boolean, delete counter document ?
 * @returns
 */
export async function conditionCounter(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  context: functions.EventContext,
  field: string | FirebaseFirestore.FieldPath,
  operator: FirebaseFirestore.WhereFilterOp,
  value: any,
  countName: string = '',
  countersCol = '_counters',
  del = false,
) {
  // simplify event types
  const { valueChange, valueCreate, getValue } = require('./tools');

  // get current field value
  const currentValue = getValue(change, field);
  const exp = eval("'" + currentValue + "'" + ' ' + operator + ' ' + "'" + value + "'");

  // if no valueChange or false new doc or false delete doc or false new field or false delete field
  if (!valueChange(change, field) || !exp) {
    return null;
  }

  // collection name
  const colId = context.resource.name.split('/')[5];
  const countDoc = `${countersCol}/${colId}`;

  const _countName = countName ? countName : field + 'Count';

  // collection references
  const countRef = db.doc(countDoc);
  const countSnap = await countRef.get();

  console.log('Updating ', _countName, ' counter on ', countRef.path);

  // increment size if field exists
  if (countSnap.get(_countName)) {
    // valueCreate || valueDelete
    const _n = valueCreate(change, field) ? 1 : -1;
    const i = admin.firestore.FieldValue.increment(_n);

    // delete counter document if necessary
    if (countSnap.get(_countName) === 1 && _n === -1 && del === true) {
      return countRef.delete();
    }
    return db
      .runTransaction(
        async (t: FirebaseFirestore.Transaction): Promise<any> => {
          // add event and update size
          return t.set(countRef, { [_countName]: i }, { merge: true });
        },
      )
      .catch((e: any) => {
        console.log(e);
      });
    // otherwise count all docs in the collection and add size
  } else {
    return db
      .runTransaction(
        async (t: FirebaseFirestore.Transaction): Promise<any> => {
          // update size
          const queryRef = db.collection(colId).where(field, operator, value);
          const colSnap = await t.get(queryRef);
          return t.set(countRef, { [_countName]: colSnap.size }, { merge: true });
        },
      )
      .catch((e: any) => {
        console.log(e);
      });
  }
}
