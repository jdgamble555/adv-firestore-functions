import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { DocumentRecord } from './types';
import { DocumentSnapshot } from 'firebase-admin/firestore';
import { eventExists } from './events';
import { getAfter, getBefore, valueChange } from './tools';
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
  change: functions.Change<DocumentSnapshot>,
  context: functions.EventContext,
  countersCol = '_counters',
) {
  // don't run if repeated function
  if (await eventExists(context)) {
    return null;
  }
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
  const isSubCol = 'subDocId' in context.params;

  const parentDoc = `${countersCol}/${parentCol ?? ''}`;
  const countDoc = isSubCol
    ? `${parentDoc}/${context.params.docId as string}/${context.params.subCollectionId as string}`
    : `${parentDoc}`;

  // collection references
  const countRef = db.doc(countDoc);
  const countSnap = await countRef.get();

  // increment size if doc exists
  if (countSnap.exists) {
    // createDoc or deleteDoc
    const n = createDoc ? 1 : -1;
    const i = admin.firestore.FieldValue.increment(n);
    return countRef.update(countRef, { count: i });

    // otherwise count all docs in the collection and add size
  } else {
    const colRef = db.collection(change.after.ref.parent.path);
    return db
      .runTransaction(async (t) => {
        // update size
        const colSnap = await t.get(colRef);
        return t.set(countRef, { count: colSnap.size });
      })
      .catch((e) => {
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
export async function queryCounter<T extends DocumentRecord<string, unknown>>(
  change: functions.Change<DocumentSnapshot<T>>,
  context: functions.EventContext,
  queryRef: FirebaseFirestore.Query<T>,
  countRef: FirebaseFirestore.DocumentReference<T>,
  countName = '',
  del = 0,
  n = 0,
  check = true,
) {
  // don't run if repeated function
  if (await eventExists(context)) {
    return null;
  }
  // simplify event types
  const createDoc = change.after.exists && !change.before.exists;
  const deleteDoc = change.before.exists && !change.after.exists;
  const shiftDoc = createDoc || deleteDoc;
  if (!shiftDoc && check) {
    return null;
  }
  // collection name
  const collectionId = context.resource.name.split('/')[5];

  if (!countName || countName.length === 0) {
    countName = collectionId + 'Count';
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

    return countRef.set({ [countName]: i } as Partial<T>, { merge: true });

    // otherwise count all docs in the collection and add size
  } else {
    return db
      .runTransaction(async (t) => {
        // update size
        const colSnap = await t.get(queryRef);
        return t.set(countRef, { [countName]: colSnap.size } as Partial<T>, {
          merge: true,
        });
      })
      .catch((e) => {
        console.log(e);
      });
  }
}

function evalBooleanExpression(
  firstOperand: string,
  operator: Omit<FirebaseFirestore.WhereFilterOp, 'array-contains' | 'in' | 'not-in' | 'array-contains-any'>,
  secondOperand: string,
) {
  switch (operator) {
    case '<':
      return firstOperand < secondOperand;
    case '<=':
      return firstOperand <= secondOperand;
    case '==':
      return firstOperand == secondOperand;
    case '!=':
      return firstOperand != secondOperand;
    case '>=':
      return firstOperand <= secondOperand;
    case '>':
      return firstOperand > secondOperand;
  }
  return false;
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
  change: functions.Change<DocumentSnapshot<DocumentRecord<string, string>>>,
  context: functions.EventContext,
  field: string | FirebaseFirestore.FieldPath,
  operator: Omit<FirebaseFirestore.WhereFilterOp, 'array-contains' | 'in' | 'not-in' | 'array-contains-any'>,
  value: string,
  countName = '',
  countersCol = '_counters',
  del = false,
) {
  const fieldString = field.toString();

  // don't run if repeated function
  if (await eventExists(context)) {
    return null;
  }

  // evaluate old and new expressions
  const trueNew = evalBooleanExpression(getAfter(change, fieldString) ?? '', operator, value);
  const trueOld = evalBooleanExpression(getBefore(change, fieldString) ?? '', operator, value);

  // change to true or change to false
  const changeToTrue: boolean = trueNew && !trueOld;
  const changeToFalse: boolean = trueOld && !trueNew;
  const changeBool = changeToTrue || changeToFalse;

  // if no valueChange or no change in expression eval
  if (!valueChange(change, fieldString) || !changeBool) {
    return null;
  }

  // collection name
  const collectionId = context.resource.name.split('/')[5];
  const countDoc = `${countersCol}/${collectionId}`;

  const _countName = countName ? countName : fieldString + 'Count';

  // collection references
  const countRef = db.doc(countDoc);
  const countSnap = await countRef.get();

  console.log('Updating ', _countName, ' counter on ', countRef.path);

  // increment size if field exists
  if (countSnap.get(_countName)) {
    // new true expression or new false expression
    const _n = changeToTrue ? 1 : -1;
    const i = admin.firestore.FieldValue.increment(_n);

    // delete counter document if necessary
    if (countSnap.get(_countName) === 1 && _n === -1 && del === true) {
      return countRef.delete();
    }

    // add event and update size
    return countRef.set({ [_countName]: i }, { merge: true });

    // otherwise count all docs in the collection and add size
  } else {
    return db
      .runTransaction(async (t) => {
        // update size
        const queryRef = db.collection(collectionId).where(field, operator as FirebaseFirestore.WhereFilterOp, value);
        const colSnap = await t.get(queryRef);
        return t.set(countRef, { [_countName]: colSnap.size }, { merge: true });
      })
      .catch((e) => {
        console.log(e);
      });
  }
}
