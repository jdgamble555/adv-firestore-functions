import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
/**
 * The check functions for type of change
 * @param change
 */
export function updateDoc(change: functions.Change<functions.firestore.DocumentSnapshot>) {
  return change.before.exists && change.after.exists;
}
export function createDoc(change: functions.Change<functions.firestore.DocumentSnapshot>) {
  return change.after.exists && !change.before.exists;
}
export function deleteDoc(change: functions.Change<functions.firestore.DocumentSnapshot>) {
  return change.before.exists && !change.after.exists;
}
export function writeDoc(change: functions.Change<functions.firestore.DocumentSnapshot>) {
  // createDoc || updateDoc
  return change.after.exists;
}
export function shiftDoc(change: functions.Change<functions.firestore.DocumentSnapshot>) {
  // createDoc || deleteDoc
  return !change.after.exists || !change.before.exists;
}
export function popDoc(change: functions.Change<functions.firestore.DocumentSnapshot>) {
  // updateDoc || deleteDoc;
  return change.before.exists;
}
/**
 * Return a friendly url for the db
 * @param url
 */
export function getFriendlyURL(url: string): string {
  // delimeter to replace '/'
  const delim = '___';

  // get rid of '/' since can't store as id
  url = url.replace(/\//g, delim);

  // create friendly URL
  return url
    .trim()
    .toLowerCase()
    .replace(/^[^a-z\d]*|[^a-z\d]*$/gi, '') // trim other characters as well
    .replace(/-/g, ' ')
    .replace(/[^\w ]+/g, '')
    .replace(/ +/g, '-');
}
/**
 * Determines if is an update or create trigger function
 * @param after
 * @param before
 */
export function canContinue(after: any, before: any): boolean {
  // if update trigger
  if (before.updatedAt && after.updatedAt) {
    if (after.updatedAt._seconds !== before.updatedAt._seconds) {
      return false;
    }
  }
  // if create trigger
  if (!before.createdAt && after.createdAt) {
    return false;
  }
  return true;
}
/**
 * Check for trigger function
 * @param change - change ref
 * @param context - event context
 */
export function isTriggerFunction(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  context: functions.EventContext,
) {
  // simplify input data
  const after: any = change.after.exists ? change.after.data() : null;
  const before: any = change.before.exists ? change.before.data() : null;

  const eventId = context.eventId;

  if (updateDoc(change) && !canContinue(after, before)) {
    console.log('Trigger function run: ', eventId);
    return true;
  }
  return false;
}
/**
 * trigger Function to update dates and filtered values
 * @param change - change event
 * @param data - data to update
 * @param updateDates - use createdAt and updatedAt
 */
export async function triggerFunction(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  data: any = {},
  updateDates = true,
) {
  if (updateDates) {
    if (createDoc(change)) {
      // createdAt
      data.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }
    if (updateDoc(change)) {
      // updatedAt
      data.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    }
  }
  if (writeDoc(change)) {
    // if there is data to update, update
    if (Object.keys(data).length) {
      console.log('Running function again to update data:', JSON.stringify(data));
      await change.after.ref.set(data, { merge: true }).catch((e: any) => {
        console.log(e);
      });
    }
  }
  return null;
}
/**
 * Gets the unique values from the combined array
 * @param a1
 * @param a2
 * @return - unique values array
 */
export function findSingleValues(a1: any[], a2: any[]): any[] {
  return a1.concat(a2).filter((v: any) => {
    if (!a1.includes(v) || !a2.includes(v)) {
      return v;
    }
  });
}
/**
 * Determine if arrays are equal
 * @param a1
 * @param a2
 * @return - boolean
 */
export function arraysEqual(a1: any[], a2: any[]): boolean {
  return JSON.stringify(a1) === JSON.stringify(a2);
}
/**
 * Get the after value or null
 * @param change
 * @param val
 */
export function getAfter(change: functions.Change<functions.firestore.DocumentSnapshot>, val: string): any {
  // simplify input data
  const after: any = change.after.exists ? change.after.data() : null;
  if (val === 'id') {
    return after ? change.after.id : '';
  }
  return after ? after[val] : '';
}
/**
 * Get the before value or null
 * @param change
 * @param val
 */
export function getBefore(change: functions.Change<functions.firestore.DocumentSnapshot>, val: string): any {
  // simplify input data
  const before: any = change.before.exists ? change.before.data() : null;
  if (val === 'id') {
    return before ? change.before.id : '';
  }
  return before ? before[val] : '';
}
/**
 * Returns the latest value of a field
 * @param change
 * @param val
 */
export function getValue(change: functions.Change<functions.firestore.DocumentSnapshot>, val: string): any {
  // simplify input data
  const after: any = change.after.exists ? change.after.data() : null;
  const before: any = change.before.exists ? change.before.data() : null;

  if (val === 'id') {
    return after ? change.after.id : change.before.id;
  }
  return after ? after[val] : before[val];
}
/**
 * Determine if there is a before value
 * @param change
 * @param val
 * @returns
 */
export function valueBefore(change: functions.Change<functions.firestore.DocumentSnapshot>, val: string): boolean {
  const before: any = change.before.exists ? change.before.data() : null;
  if (before && before[val] !== undefined) {
    return true;
  }
  return false;
}
/**
 * Determine if there is an after value
 * @param change
 * @param val
 * @returns
 */
export function valueAfter(change: functions.Change<functions.firestore.DocumentSnapshot>, val: string): boolean {
  const after: any = change.after.exists ? change.after.data() : null;
  if (after && after[val] !== undefined) {
    return true;
  }
  return false;
}
/**
 * Determine if a field has been created
 * @param change
 * @param val - field
 * @returns
 */
export function valueCreate(change: functions.Change<functions.firestore.DocumentSnapshot>, val: string): boolean {
  if (!valueBefore(change, val) && valueAfter(change, val)) {
    return true;
  }
  return false;
}
/**
 * Determine if a field has been deleted
 * @param change
 * @param val - field
 * @returns
 */
export function valueDelete(change: functions.Change<functions.firestore.DocumentSnapshot>, val: string): boolean {
  if (valueBefore(change, val) && !valueAfter(change, val)) {
    return true;
  }
  return false;
}
/**
 * Determine if a field value has been updated
 * @param change
 * @param val
 */
export function valueChange(change: functions.Change<functions.firestore.DocumentSnapshot>, val: string): boolean {
  if (createDoc(change) || deleteDoc(change) || valueDelete(change, val) || valueCreate(change, val)) {
    return true;
  }
  if (arraysEqual(getBefore(change, val), getAfter(change, val))) {
    return false;
  }
  return true;
}
/**
 * Returns the collection name
 * @param context
 */
export function getCollection(context: functions.EventContext) {
  return context.resource.name.split('/')[5];
}
/**
 * Checks for any updated value in array
 * @param change - change event
 * @param arr - array of values to check
 */
export function arrayValueChange(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  arr: string[],
): boolean {
  // check each array
  for (const v of arr) {
    if (valueChange(change, v)) {
      return true;
    }
  }
  return false;
}
/**
 * Returns the category array
 * @param category
 */
export function getCatArray(category: string): any[] {
  // create catPath and catArray
  const catArray: string[] = [];
  let cat = category;

  while (cat !== '') {
    catArray.push(cat);
    cat = cat.split('/').slice(0, -1).join('/');
  }
  return catArray;
}
/**
 * check for foreign key field(s) change
 * @param change
 * @param fk
 */
export function fkChange(change: functions.Change<functions.firestore.DocumentSnapshot>, fk: any) {
  // simplify input data
  const after: any = change.after.exists ? change.after.data() : null;
  const before: any = change.before.exists ? change.before.data() : null;

  if (Array.isArray(fk)) {
    for (const k of fk) {
      if (before[k] !== after[k]) {
        return true;
      }
    }
    return false;
  }
  return before[fk] !== after[fk];
}
