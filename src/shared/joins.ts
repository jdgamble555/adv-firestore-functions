import * as functions from 'firebase-functions';
/**
 * Update foreign key join data
 * @param change - change event
 * @param queryRef - query for fk docs
 * @param fields - fields to update
 * @param field - field to store updated fields
 */
export async function updateJoinData(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  queryRef: FirebaseFirestore.Query,
  fields: string[],
  field: string,
  del = false,
) {
  // simplify event types
  const createDoc = change.after.exists && !change.before.exists;
  const updateDoc = change.before.exists && change.after.exists;
  const writeDoc = createDoc || updateDoc;

  const { arrayValueChange } = require('./tools');
  const { bulkUpdate, bulkDelete } = require('./bulk');

  // only update if necessary
  if (!arrayValueChange(change, fields)) {
    return null;
  }

  // get array of doc references
  const querySnap = await queryRef.get();
  const joinDocs: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>[] = [];
  querySnap.forEach((q: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>) => {
    joinDocs.push(q.ref);
  });

  if (writeDoc) {
    // get join data
    const after: any = change.after.exists ? change.after.data() : null;
    const joinData: any = {};
    fields.forEach((f: string) => {
      joinData[f] = after[f];
    });

    // update bulk
    await bulkUpdate(joinDocs, field, joinData);
  } else {
    // only delete if del = true
    if (del) {
      // delete bulk
      await bulkDelete(joinDocs, field);
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
  fieldExceptions: string[],
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
  const targetData: any = targetSnap.data();
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
  await targetRef.set(data, { merge: true }).catch((e: any) => {
    console.log(e);
  });
  return null;
}
