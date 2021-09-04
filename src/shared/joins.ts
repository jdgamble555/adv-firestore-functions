import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
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
export async function updateJoinData(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  queryRef: FirebaseFirestore.Query,
  fields: string[] | null,
  field: string,
  del = false,
  isMap = true,
) {
  const { arrayValueChange, writeDoc } = require('./tools');
  const { bulkUpdate, bulkDelete } = require('./bulk');

  // only update if necessary
  if (!arrayValueChange(change, fields)) {
    return null;
  }
  // get array of doc references
  const querySnap = await queryRef.get();
  const docRefs: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>[] = [];
  querySnap.forEach((q: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>) => {
    docRefs.push(q.ref);
  });

  if (writeDoc) {
    // get join data
    const after: any = change.after.exists ? change.after.data() : null;
    let joinData: any = {};
    if (fields) {
      fields.forEach((f: string) => {
        joinData[f] = after[f];
      });
    } else {
      joinData = after;
    }
    // get data
    const data: any = {};

    // handle map types...
    if (isMap && field.includes('.')) {
      const keys = field.split('.');
      const last = keys.pop() || '';
      keys.reduce((o, k) => (o[k] = o[k] || {}), data)[last] = joinData;
    } else {
      data[field] = joinData;
    }
    // update bulk
    console.log('Update docs on ', field, ' field');
    await bulkUpdate(docRefs, data);
  } else {
    // only delete if del = true
    if (del) {
      // delete bulk
      await bulkDelete(docRefs);
    }
  }
  return null;
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
export async function createJoinData(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  targetRef: FirebaseFirestore.DocumentReference,
  fields: string[],
  field: string = '',
  data: any = {},
  alwaysCreate = false,
): Promise<any> {
  const newData = await getJoinData(change, targetRef, fields, field, data, alwaysCreate);

  // add data to document
  const { triggerFunction } = require('./tools');
  await triggerFunction(change, newData);

  return null;
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
export async function getJoinData(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  targetRef: FirebaseFirestore.DocumentReference,
  fields: string[],
  field: string = '',
  data: any = {},
  alwaysCreate = false,
): Promise<any> {
  // simplify input data
  const createDoc = change.after.exists && !change.before.exists;

  if (!field) {
    field = targetRef.path.split('/')[0];
  }
  // see if need to create data
  if (createDoc || alwaysCreate) {
    const targetSnap = await targetRef.get();
    const targetData: any = targetSnap.data();
    const joinData: any = {};
    fields.forEach((f: string) => {
      joinData[f] = targetData[f];
    });
    data[field] = joinData;
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
export async function aggregateData(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  context: functions.EventContext,
  targetRef: FirebaseFirestore.DocumentReference,
  queryRef: FirebaseFirestore.Query,
  fieldExceptions: string[] = [],
  aggregateField: string = '',
  n: number = 3,
  data: any = {},
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
  data[aggregateField] = [];

  // doc references
  const targetSnap = await targetRef.get();
  const querySnap = await queryRef.limit(n).get();
  const targetData: any = targetSnap.exists ? targetSnap.data() : { aggregateField };
  const targetDocs: any[] = targetData[aggregateField];

  // check if aggregation is necessary
  if (popDoc && !alwaysAggregate) {
    if (targetDocs) {
      let docExists = false;
      targetDocs.forEach((doc: any) => {
        if (doc.id === docId) {
          docExists = true;
        }
      });
      // don't update aggregation if doc not already in aggregation
      // or if doc is not being created
      if (!docExists) {
        return null;
      }
    }
  }
  // get the latest data, save it
  querySnap.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
    // document data
    const d = doc.data();
    const id = 'id';
    d[id] = doc.id;

    // don't save the field exceptions
    fieldExceptions.forEach((field: string) => {
      delete d[field];
    });
    data[aggregateField].push(d);
  });
  console.log('Aggregating ', colId, ' data on ', targetRef.path);
  // add aggregate information
  await targetRef.set(data, { merge: true }).catch((e: any) => {
    console.log(e);
  });
  return null;
}

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
export async function arrayIndex(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  context: functions.EventContext,
  _opts: {
    fieldToIndex?: string,
    max?: number,
    type?: "array" | "map",
    indexFieldName?: string,
    indexColName?: string,
    indexPath?: string,
    docToIndex?: string,
    docFieldsToIndex?: string | string[],
    docFieldName?: string,
    docSortField?: string,
    docSortType?: "id" | "value" | null
  } = {}

): Promise<void> {

  const path = context.resource.name.split("/").splice(5);
  const parentDoc = path.slice(0, -2).join("/");
  const colName = path.slice(0, -1).pop() as string;
  const rootColName = path.slice(0, -3).join("/");
  const docId = path.pop();

  // define default options
  const opts = {
    fieldToIndex: _opts.fieldToIndex || "id",
    max: _opts.max || 10000,
    type: _opts.type || "array",
    indexFieldName: _opts.indexFieldName || colName,
    indexColName: _opts.indexColName || `${colName}_index`,
    indexPath: _opts.indexPath || parentDoc,
    docToIndex: _opts.docToIndex || parentDoc,
    docFieldsToIndex: _opts.docFieldsToIndex,
    docFieldName: _opts.docFieldName || rootColName,
    docSortField: _opts.docSortField || "createdAt",
    docSortType: _opts.docSortType || null
  };

  const indexColRef = db.collection(`${opts.indexPath}/${opts.indexColName}`);

  // get latest index doc
  const latestSnap = await indexColRef.orderBy("createdAt", "desc").limit(1).get();
  const latest = latestSnap.empty ? {} : latestSnap.docs[0].data();

  const { deleteDoc } = require('./tools');

  if (deleteDoc(change)) {

    // get data to be stored in field
    const fieldValue = opts.fieldToIndex === "id"
      ? docId
      : (change.before.data() as any)[opts.fieldToIndex];

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
      }, { merge: true });
    }
    // update or create doc
  } else {

    // get data to be stored in field
    const fieldValue = opts.fieldToIndex === "id"
      ? docId
      : (change.after.data() as any)[opts.fieldToIndex];

    // get size of storage field
    let fieldLen = 0;
    if (!latestSnap.empty) {
      const field = latest[opts.indexFieldName];
      fieldLen = opts.type === "array"
        ? (field as any[]).length
        : Object.keys(field).length;
    }

    // create new doc if no doc or doc too big
    if (latestSnap.empty || fieldLen >= opts.max) {

      // aggregate data to doc
      let indexData = (await db.doc(opts.docToIndex).get()).data() as any;
      if (opts.docFieldsToIndex) {
        indexData = typeof opts.docFieldsToIndex === "string"
          ? opts.docFieldsToIndex
          : indexData.filter((f: string) => f in (opts.docFieldsToIndex as string[]))
      }

      // array or map type
      let sortField = indexData[opts.docSortField];

      if (sortField['_seconds']) {
        sortField = admin.firestore.Timestamp.fromDate(
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
        ? (sortField instanceof admin.firestore.Timestamp
          ? indexData[opts.docSortField].toDate().toISOString()
          : sortField) + '__' + indexColRef.doc().id
        : indexColRef.doc().id;

      console.log(`Creating ${fieldValue} index for ${opts.indexFieldName} on ${opts.indexColName}`);
      await indexColRef.doc(newID).set({
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        [opts.indexFieldName]: newVal,
        [opts.docFieldName]: indexData
      });
      // update doc
    } else {

      const latestID = latestSnap.docs[0].id;

      let sortField = latest[opts.docFieldName][opts.docSortField];

      // if timestamp
      if (sortField['_seconds']) {
        sortField = admin.firestore.Timestamp.fromDate(
          sortField.toDate()
        );
      }

      // array or map type
      const updateVal = opts.type === "array"
        ? admin.firestore.FieldValue.arrayUnion(fieldValue)
        : { [fieldValue]: opts.docSortType === "value" ? sortField : true };

      // add to existing doc
      console.log(`Updating ${fieldValue} index for ${opts.indexFieldName} on ${opts.indexColName}`);
      await indexColRef.doc(latestID).set({
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        [opts.indexFieldName]: updateVal
      }, { merge: true });
    }
  }
}
