import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { arrayValueChange, deleteDoc, writeDoc, triggerFunction, isTimestamp } from './tools';
import { bulkUpdate, bulkDelete } from './bulk';
import { CollectionReference, DocumentSnapshot, FieldValue, Timestamp } from 'firebase-admin/firestore';

try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
const db = admin.firestore();
/**
 * Update foreign key join data
 * @param change - change event
 * @param queryRef - query for fk docs
 * @param fields - fields to update, default *
 * @param field - field to store updated fields
 * @param isMap - see if field dot notation equals map, default true
 */
export async function updateJoinData<T extends Record<string, unknown>>(
  change: functions.Change<DocumentSnapshot<T>>,
  queryRef: FirebaseFirestore.Query<T>,
  fields: (keyof T)[],
  field: keyof T,
  del = false,
  isMap = true,
) {

  // only update if necessary
  if (fields && !arrayValueChange(change, fields)) {
    return;
  }
  // get array of doc references
  const querySnap = await queryRef.get();
  const docRefs: FirebaseFirestore.DocumentReference<T>[] = [];
  querySnap.forEach((q: FirebaseFirestore.QueryDocumentSnapshot<T>) => {
    docRefs.push(q.ref);
  });

  if (writeDoc(change)) {
    // get join data
    const after = change.after.exists ? change.after.data() : null;
    let joinData = {} as T;
    if (fields) {
      fields.forEach((f) => {
        joinData[f] = after?.[f] as T[keyof T];
      });
    } else {
      joinData = after ?? {} as T;
    }
    // get data
    const data = {} as T;

    // handle map types...
    if (isMap && typeof field === 'string' && field.includes('.')) {
      const keys = field.split('.') as (keyof T)[];
      const last = keys.pop();
      if (last) {
        // Previously was: keys.reduce((o, k) => (o[k] = o[k] || {}), data)[last] = joinData;
        keys.reduce((prev, curr) => ({[curr]: {},...prev}), data)[last] = joinData as T[keyof T];
      }
    } else if (field in data) {
      data[field] = joinData as T[keyof T];
    }
    // update bulk
    console.log('Update docs on ', field, ' field');
    bulkUpdate(docRefs, data);
  } else {
    // only delete if del = true
    if (del) {
      // delete bulk
      bulkDelete(docRefs);
    }
  }
  return;
}
/**
 * Create data to join on document
 * @param change - change event
 * @param targetRef - the target document
 * @param fields - the fields to get from the target document
 * @param field - the field to store the target document fields
 * @param data - data object to update
 * @param alwaysCreate - create even if not necessary
 */
export async function createJoinData<T extends Record<string, unknown>>(
  change: functions.Change<DocumentSnapshot<T>>,
  targetRef: FirebaseFirestore.DocumentReference<T>,
  fields: (keyof T)[],
  field: keyof T = '',
  data = {} as T,
  alwaysCreate = false,
) {
  const newData = await getJoinData(change, targetRef, fields, field, data, alwaysCreate);

  // add data to document
  return triggerFunction(change, newData);
}

/**
 * Get data to join on document
 * @param change - change event
 * @param targetRef - the target document
 * @param fields - the fields to get from the target document
 * @param field - the field to store the target document fields
 * @param data - data object to update
 * @param alwaysCreate - create even if not necessary
 */
export async function getJoinData<T extends Record<string, unknown>>(
  change: functions.Change<DocumentSnapshot<T>>,
  targetRef: FirebaseFirestore.DocumentReference<T>,
  fields: (keyof T)[],
  field: keyof T = '',
  data = {} as T,
  alwaysCreate = false,
): Promise<T> {
  // simplify input data
  const createDoc = change.after.exists && !change.before.exists;

  if (!field) {
    field = targetRef.path.split('/')[0];
  }
  // see if need to create data
  if (createDoc || alwaysCreate) {
    const targetSnap = await targetRef.get();
    const targetData = targetSnap.data();
    const joinData = {} as T;
    fields.forEach((f) => {
      joinData[f] = (targetData?.[f] ?? {}) as T[keyof T];
    });
    data[field] = joinData as T[keyof T];
  }
  console.log('Getting join data from ', targetRef.path, ' doc');
  return data;
}
/**
 * Aggregate data
 * @param change - change functions snapshot
 * @param context - event context
 * @param targetRef - document reference to edit
 * @param queryRef - query reference to aggregate on doc
 * @param fieldExceptions - the fields not to include
 * @param aggregateField - the name of the aggregated field
 * @param n - the number of documents to aggregate, default 3
 * @param data - if adding any other data to the document
 * @param alwaysAggregate - skip redundant aggregation, useful if not date sort
 */
export async function aggregateData<T extends Record<string, unknown>>(
  change: functions.Change<DocumentSnapshot<T>>,
  context: functions.EventContext,
  targetRef: FirebaseFirestore.DocumentReference<T>,
  queryRef: FirebaseFirestore.Query<T>,
  fieldExceptions: (keyof T)[] = [],
  aggregateField: keyof T = '',
  n = 3,
  data = {} as T,
  alwaysAggregate = false,
) {
  // simplify event types
  const updateDoc = change.before.exists && change.after.exists;
  const deleteDoc = change.before.exists && !change.after.exists;
  const popDoc = updateDoc || deleteDoc;

  // collection name and doc id
  const cols = context.resource.name.split('/');
  const colId = cols[cols.length - 2];
  const docId = cols[cols.length - 1];

  if (!aggregateField) {
    aggregateField = colId + 'Aggregate';
  }
  data[aggregateField] = [] as T[keyof T];

  // doc references
  const targetSnap = await targetRef.get();
  const querySnap = await queryRef.limit(n).get();
  const targetData = targetSnap.exists ? targetSnap.data() /* We know it exists */ as T : { [aggregateField]: aggregateField } as T;
  const targetDocs = targetData[aggregateField] as T[];

  // check if aggregation is necessary
  if (popDoc && !alwaysAggregate) {
    if (targetDocs) {
      let docExists = false;
      targetDocs.forEach((doc) => {
        if (doc.id === docId) {
          docExists = true;
        }
      });
      // don't update aggregation if doc not already in aggregation
      // or if doc is not being created
      if (!docExists) {
        return;
      }
    }
  }
  // get the latest data, save it
  querySnap.docs.forEach((doc) => {
    // document data
    const d = doc.data();
    const id: keyof T = 'id';
    d[id] = doc.id as T[keyof T];

    // don't save the field exceptions
    fieldExceptions.forEach((field) => {
      delete d[field];
    });
    const dataValue = data[aggregateField];
    if (Array.isArray(dataValue)) {
      dataValue.push(d);
    }
  });
  console.log('Aggregating ', colId, ' data on ', targetRef.path);
  // add aggregate information
  await targetRef.set(data, { merge: true }).catch((e: Error) => {
    console.log(e);
  });
  return;
}

type ArrayIndexOptions<T extends Record<string, unknown>> = {
  fieldToIndex?: string;
  max?: number;
  type?: 'array' | 'map';
  indexFieldName?: (string & keyof T);
  indexColName?: string;
  indexPath?: string;
  docToIndex?: string;
  docFieldsToIndex?: (string & keyof T) | (string & keyof T)[];
  docFieldName?: string & keyof T;
  docSortField?: string & keyof T;
  docSortType?: 'id' | 'value' | null;
};

/**
 * @param change - change functions snapshot
 * @param context - event context
 * @param _opts : {
 *   fieldToIndex - field to save in array or map, default id
 *   max - maximum number of items in array / map, default 10,000
 *   type - array or map, default array
 *   indexFieldName - name of field to store array, defaults to collection name
 *   indexColName - name of new index collection, default collection_name__index
 *   indexPath - path to store new collection, defaults to parent doc
 *   docToIndex - doc to index with array, defaults to to parent doc
 *   docFieldsToIndex - fields from parent doc to index, default *
 *   docFieldName - name of field to store parent doc in, defaults to col name
 *   docSortField - name of field to sort documents by, default createdAt
 *   docSortType - sort by id or value (add id sort, or map value sort), default null
 * }
 */
export async function arrayIndex<T extends {updatedAt?: FieldValue; createdAt?: FieldValue} & Record<string, unknown>>(
  change: functions.Change<DocumentSnapshot<T>>,
  context: functions.EventContext,
  _opts: ArrayIndexOptions<T> = {}
): Promise<void> {

  const path = context.resource.name.split("/").splice(5);
  const parentDoc = path.slice(0, -2).join("/");
  const colName = path.slice(0, -1).pop() as string;
  const rootColName = path.slice(0, -3).join("/");
  const docId = path.pop();

  // define default options
  const opts: Required<Omit<ArrayIndexOptions<T>,'docFieldsToIndex'>> & Pick<ArrayIndexOptions<T>,'docFieldsToIndex'> = {
    fieldToIndex: _opts.fieldToIndex ?? "id",
    max: _opts.max ?? 10000,
    type: _opts.type ?? "array",
    indexFieldName: _opts.indexFieldName ?? colName,
    indexColName: _opts.indexColName ?? `${colName}_index`,
    indexPath: _opts.indexPath ?? parentDoc,
    docToIndex: _opts.docToIndex ?? parentDoc,
    docFieldsToIndex: _opts.docFieldsToIndex,
    docFieldName: _opts.docFieldName ?? rootColName,
    docSortField: _opts.docSortField ?? "createdAt",
    docSortType: _opts.docSortType ?? null
  };

  const indexColRef = db.collection(`${opts.indexPath}/${opts.indexColName}`) as CollectionReference<T>;

  // get latest index doc
  const latestSnap = await indexColRef.orderBy("createdAt", "desc").limit(1).get();
  const latest = latestSnap.empty ? {} as T : latestSnap.docs[0].data();

  if (deleteDoc(change)) {

    // get data to be stored in field
    const fieldValue = opts.fieldToIndex === "id"
      ? docId
      : (change.before.data())?.[opts.fieldToIndex];

    if (!fieldValue || typeof fieldValue !== 'string') {
      return;
    }

    // array or map type
    const deleteVal = opts.type === "array"
      ? admin.firestore.FieldValue.arrayRemove(fieldValue)
      : { [fieldValue]: admin.firestore.FieldValue.delete() };

    // don't delete if no doc to delete
    if (!latestSnap.empty) {
      console.log(`Removing ${fieldValue} index from ${opts.indexFieldName} on ${opts.indexColName}`);
      await indexColRef.doc(latestSnap.docs[0].id).set({
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        [opts.indexFieldName]: deleteVal
      } as Partial<T>, { merge: true });
    }
    // update or create doc
  } else {

    // get data to be stored in field
    const fieldValue = opts.fieldToIndex === "id"
      ? docId
      : (change.after.data())?.[opts.fieldToIndex];

      if (!fieldValue || typeof fieldValue !== 'string') {
        return;
      }

    // get size of storage field
    let fieldLen = 0;
    if (!latestSnap.empty) {
      const field = latest[opts.indexFieldName];
      fieldLen = opts.type === "array"
        ? (field as unknown[]).length
        : Object.keys(field as object).length;
    }

    // create new doc if no doc or doc too big
    if (latestSnap.empty || fieldLen >= opts.max) {

      // aggregate data to doc
      let indexData = (await db.doc(opts.docToIndex).get()).data() as T | undefined;
      if (opts.docFieldsToIndex) {
        indexData = typeof opts.docFieldsToIndex === "string"
          ? {[opts.docFieldsToIndex]:opts.docFieldsToIndex} as T /** TODO: Not to sure what's supposed to happen here */
          : opts.docFieldsToIndex
            .reduce((obj, key) => ({ ...obj, [key]: indexData?.[key] }), {} as T);
      }

      // array or map type
      // TODO: this is a little odd. see the newID section below
      const originalSortField = indexData?.[opts.docSortField];
      let sortField = originalSortField;

      if (isTimestamp(sortField)) {
        sortField = Timestamp.fromDate(
          sortField.toDate()
        );
      }

      // get fb value
      const newVal = opts.type === "array"
        ? [fieldValue]
        : {
          [fieldValue]: opts.docSortType === "value"
            ? sortField
            : true
        };

      // get new id possibly from type
      const newID = opts.docSortType === 'id'
        ? (isTimestamp(originalSortField)
          ? originalSortField.toDate().toISOString() 
          : sortField as string) + '__' + indexColRef.doc().id
        : indexColRef.doc().id;

      console.log(`Creating ${fieldValue} index for ${opts.indexFieldName} on ${opts.indexColName}`);
      await indexColRef.doc(newID).set({
        createdAt: FieldValue.serverTimestamp(),
        [opts.indexFieldName]: newVal,
        [opts.docFieldName]: indexData
      } as T);
      // update doc
    } else {

      const latestID = latestSnap.docs[0].id;

      let sortField = latest[opts.docFieldName][opts.docSortField] as unknown;

      // if timestamp
      if (isTimestamp(sortField)) {
        sortField = Timestamp.fromDate(
          sortField.toDate()
        );
      }

      // array or map type
      const updateVal = opts.type === "array"
        ? FieldValue.arrayUnion(fieldValue)
        : { [fieldValue]: opts.docSortType === "value" ? sortField : true };

      // add to existing doc
      console.log(`Updating ${fieldValue} index for ${opts.indexFieldName} on ${opts.indexColName}`);
      await indexColRef.doc(latestID).set({
        updatedAt: FieldValue.serverTimestamp(),
        [opts.indexFieldName]: updateVal
      } as T, { merge: true });
    }
  }
}
