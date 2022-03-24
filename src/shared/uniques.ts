import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { getBefore, createDoc, updateDoc, deleteDoc, getFriendlyURL } from './tools';
import { DocumentSnapshot } from 'firebase-admin/firestore';
import { DocumentRecord } from './types';
try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
const db = admin.firestore();
/**
 * Creates a unique field index
 * @param colPath - collection / field name
 * @param field - field value
 * @param fkName - foreign key name
 * @param fkVal - foreign key value
 * @param uniqueCol - unique collection
 */
export async function createField<T extends DocumentRecord<string, unknown>>(
  colPath: string,
  field: keyof T,
  fkName: string,
  fkVal: unknown,
  uniqueCol = '_uniques',
) {
  console.log('Creating unique index on ', field);

  const titleRef = db.doc(`${uniqueCol}/${colPath}/${field.toString()}`);
  return titleRef.set({ [fkName]: fkVal }).catch((e: Error) => {
    console.log(e);
  });
}
/**
 * Deletes a unique field index
 * @param colPath - collection / field name
 * @param field - field value
 * @param uniqueCol - unique collection
 */
export async function deleteField<T extends DocumentRecord<string, unknown>>(
  colPath: string,
  field: keyof T,
  uniqueCol = '_uniques',
) {
  console.log('Deleting unique index on ', field);

  const titleRef = db.doc(`${uniqueCol}/${colPath}/${field.toString()}`);
  return titleRef.delete().catch((e: Error) => {
    console.log(e);
  });
}
/**
 * Updates a unique field index
 * @param colPath - collection / field name
 * @param oldField - old field value
 * @param newField - new field value
 * @param fkName - foreign key name
 * @param fkVal - foreign key value
 * @param uniqueCol - unique collectino
 */
export async function updateField<T extends DocumentRecord<string, unknown>>(
  colPath: string,
  oldField: keyof T,
  newField: keyof T,
  fkName: string,
  fkVal: unknown,
  uniqueCol = '_uniques',
) {
  console.log('Changing unique index from ', oldField, ' to ', newField);

  const oldTitleRef = db.doc(`${uniqueCol}/${colPath}/${oldField.toString()}`);
  const newTitleRef = db.doc(`${uniqueCol}/${colPath}/${newField.toString()}`);
  const batch = db.batch();

  batch.delete(oldTitleRef);
  batch.create(newTitleRef, { [fkName]: fkVal });

  return batch.commit().catch((e: Error) => {
    console.log(e);
  });
}
/**
 * Handle all unique instances
 * @param change - change snapshot
 * @param context - event context
 * @param field - feild to index
 * @param friendly - boolean: save friendly string
 * @param newField - the value of the field if you want to filter it
 * @param fkName - name of foreign key field
 * @param uniqueCol - name of unique collection
 */
export async function uniqueField<T extends DocumentRecord<string, string>>(
  change: functions.Change<DocumentSnapshot<T>>,
  context: functions.EventContext,
  field: keyof T,
  friendly = false,
  newField: keyof T = '',
  fkName = 'docId',
  uniqueCol?: string,
) {
  // get column information
  const colId = context.resource.name.split('/')[5];
  const fkVal = context.params[fkName] as unknown;

  const uniquePath = colId + '/' + field.toString();

  // NOTE: newField will always be something
  // get new and old field values
  // if (!newField) {
  //   newField = getAfter(change, field);
  // }
  let oldField = getBefore(change, field);

  if (friendly) {
    newField = getFriendlyURL(newField.toString());
    oldField = getFriendlyURL(oldField?.toString() ?? '') as T[keyof T];
  }

  const fieldChanged = newField !== oldField;

  if (createDoc(change)) {
    await createField(uniquePath, newField, fkName, fkVal, uniqueCol);
  }
  if (deleteDoc(change)) {
    await deleteField(uniquePath, oldField as keyof T, uniqueCol);
  }
  if (updateDoc(change) && fieldChanged) {
    await updateField(uniquePath, oldField as keyof T, newField, fkName, fkVal, uniqueCol);
  }
  return null;
}
