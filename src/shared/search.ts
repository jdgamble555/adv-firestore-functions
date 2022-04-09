import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { CollectionReference, DocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore';
import { eventExists } from './events';
import { bulkDelete, ArrayChunk } from './bulk';
import {
  popDoc,
  deleteDoc,
  valueChange,
  foreignKeyChange,
  getValue,
  writeDoc,
  createDoc,
  getAfter,
  generateTrigrams,
} from './tools';
import { DocumentRecord } from './types';
import { htmlToText } from 'html-to-text';

// DEFAULTS
const DELIM = '__';
const _SEARCH = '_search';
const _MERGED = '_merged';
const _TERM = '_term';
const _TRIGRAMS = '_trigrams';
/**
 * Extract collection name from firestore path
 * @param context event context
 * @param path full path to collection or document
 * @returns a string with just the collection name (no '/')
 */
function extractCollectionNameFromPath({ resource: { name } }: functions.EventContext, path = '') {
  return name.slice(name.indexOf(path) + path.length).split('/')[1]; // path starts with / so [0] is empty string
}

// TYPES

type RelevantSearchOptions = {
  query: string;
  rootCollectionPath?: string;
  collectionToSearch: string;
  fieldsToSearch?: string[];
  searchCollectionName?: string;
  termField?: string;
  filterFunc?: (value: string) => string;
  limit?: number;
  startId?: string;
};

type RelevantIndexOptions = {
  fieldsToIndex: string[];
  rootCollectionPath?: string;
  searchCollectionName?: string;
  numWords?: number;
  mergeFields?: boolean;
  mergedCollectionName?: string;
  termField?: string;
  filterFunc?: (value: string) => string;
};

type SearchResult = { id: string; relevance: number };

type TrigramSearchOptions = {
  query: string;
  rootCollectionPath?: string;
  collectionToSearch: string;
  fieldsToSearch?: string[];
  searchCollectionName?: string;
  termField?: string;
  limit?: number;
};

type TrigramIndexOptions = {
  rootCollectionPath?: string;
  trigramCollectionName?: string;
  mergedCollectionName?: string;
  mergeFields?: boolean;
  termField?: string;
  fieldsToIndex: string[];
};

try {
  admin.initializeApp();
} catch (e) {
  /* empty */
}
const db = admin.firestore();

/**
 * Full Text Search
 * @param change - functions change interface
 * @param context - event context
 * @param fieldToIndex - the field to index
 * @param foreignKey - the foreign key fields to get
 * @param type - { id, map, array } - defaults to id
 * @param numChunks - number of word chunks to index at a time
 * @param searchCollectionName - name of search collection
 */
export async function fullTextIndex(
  change: functions.Change<DocumentSnapshot<DocumentRecord<string, string>>>,
  context: functions.EventContext,
  fieldToIndex: string,
  foreignKey = 'id',
  type = 'id',
  numChunks = 6,
  searchCollectionName = _SEARCH,
  rootCollectionPath = '',
  contextParamsKey = 'docId',
) {
  // don't run if repeated function
  if (await eventExists(context)) {
    return null;
  }
  // get collection
  const collectionToIndex = extractCollectionNameFromPath(context, rootCollectionPath);
  const {
    params: { [contextParamsKey]: docId },
  } = context;

  if (typeof collectionToIndex !== 'string' || collectionToIndex.length < 1) {
    throw new Error('Missing collection Id');
  }

  if (typeof docId !== 'string' || docId.length < 1) {
    throw new Error('Missing doc Id');
  }

  const collectionToIndexDocument = db.doc(`${rootCollectionPath}/${searchCollectionName}/${collectionToIndex}`);

  // update or delete
  if (popDoc(change)) {
    // if deleting doc, field change, or foreign key change
    if (deleteDoc(change) || valueChange(change, fieldToIndex) || foreignKeyChange(change, foreignKey)) {
      // get old key to delete
      const foreignKeyValue = getValue(change, foreignKey);

      // remove old indexes
      const delDocs: FirebaseFirestore.DocumentReference[] = [];

      // see if search for id field
      const sForeignKey = foreignKey === 'id' ? admin.firestore.FieldPath.documentId() : foreignKey;

      const searchSnap = await collectionToIndexDocument
        .collection(fieldToIndex)
        .where(sForeignKey, '==', foreignKeyValue)
        .get();
      searchSnap.forEach((doc) => {
        // collect all document references
        delDocs.push(doc.ref);
      });

      // delete data
      bulkDelete(delDocs);
    }
  }
  // create or update
  if (writeDoc(change)) {
    // if creating a doc, field change, or foreign key change
    if (createDoc(change) || valueChange(change, fieldToIndex) || foreignKeyChange(change, foreignKey)) {
      // add new foreign key field(s)
      // TODO: This doesn't seem right? getValue not really setup to deal with arrays
      const foreignKeys = {} as DocumentRecord<string, string>;
      // if (Array.isArray(fk)) {
      //   fk.forEach((k) => {
      //     fkeys[k] = getValue(change, k);
      //   });
      // } else {
      foreignKeys[foreignKey] = getValue(change, foreignKey);
      // }
      // new indexes
      const fieldValue = getAfter(change, fieldToIndex);

      if (fieldValue === null || fieldValue === undefined) {
        return;
      }

      // TODO: not an array, should we just remove?
      // if array, turn into string
      // if (Array.isArray(fieldValue)) {
      //   fieldValue = fieldValue.join(' ');
      // }

      console.log('Generating index array on ', fieldToIndex, ' field');
      const index = createIndex(fieldValue, numChunks);
      const numDocs = index.length;

      // chunk index array at 100 items
      const chunks = new ArrayChunk(index);
      chunks.forEachChunk(async (chunk) => {
        const batch = db.batch();
        // create the docs in batches
        chunk.forEach((phrase) => {
          if (!phrase) {
            return;
          }
          const searchRef = collectionToIndexDocument.collection(fieldToIndex).doc(`${phrase}${DELIM}${docId}`);
          const data = {} as DocumentRecord<string, string[] | DocumentRecord<string, boolean>>;

          // if index for array and map types
          if (type === 'map' || type === 'array') {
            // map and array term index

            let v = '';
            const a = [] as string[];
            const m = {} as DocumentRecord<string, boolean>;
            for (let i = 0; i < phrase.length; i++) {
              v = phrase.slice(0, i + 1);
              if (type === 'map') {
                m[v] = true;
              } else {
                a.push(v);
              }
            }
            data[_TERM] = type === 'map' ? m : a;
          }
          batch.set(searchRef, { ...foreignKeys, ...data }, { merge: true });
        });
        console.log('Creating batch of docs on ', fieldToIndex, ' field');
        await batch.commit().catch((e) => {
          console.log(e);
        });
      });
      console.log('Finished creating ', numDocs, ' docs on ', fieldToIndex, ' field');
    }
  }
  return null;
}
/**
 * Relevant search callable function
 * @param _opts {
 *   query - query to search
 *   rootCollectionPath - path to root of search to keep users separate
 *   collectionToSearch - collection to search
 *   fieldsToSearch - fields to search
 *   searchCollectionName - name of search collection, default _search
 *   termField - name of term field to search, default _term
 *   filterFunc - name of function to filter
 *   limit - number of search results to limit, default 10
 *   startId - id field for paging, only works with _all index
 * }
 * @retuns - will return a sorted array of docs with {id, relevance}
 *   the higher the relevance, the better match it is...
 */
export async function relevantSearch({
  query,
  rootCollectionPath,
  collectionToSearch,
  fieldsToSearch = [_MERGED],
  searchCollectionName = _SEARCH,
  termField = _TERM,
  filterFunc,
  limit,
  startId,
}: RelevantSearchOptions): Promise<SearchResult[]> {
  // if soundex function or other filter
  const exp =
    filterFunc !== undefined
      ? query
          .split(' ')
          .map((v) => filterFunc(v))
          .join(' ')
      : query;

  const collectionToSearchDocument = db.doc(
    `${rootCollectionPath ?? ''}/${searchCollectionName}/${collectionToSearch}`,
  );
  const mergedCollection = collectionToSearchDocument.collection('_merged');

  if (fieldsToSearch.includes('_merged')) {
    let query = mergedCollection.orderBy(`${termField}.${exp}`, 'desc');
    if (limit) {
      query = query.limit(limit);
    }
    if (startId) {
      query.startAfter(mergedCollection.doc(`${startId}`));
    }

    // return results
    const docsSnap = await query.get();

    return docsSnap.docs.map((doc) => {
      const { _term } = doc.data() as { _term?: DocumentRecord<string, number> };
      const { id } = doc;
      const relevance = _term?.[exp] as number;
      return { id, relevance } as SearchResult;
    });
  }

  // get queries for each field
  const s = [];
  for (const field of fieldsToSearch) {
    let query = collectionToSearchDocument.collection(field).orderBy(`${termField}.${exp}`, 'desc');
    if (limit) {
      query = query.limit(limit);
    }
    s.push(query.get());
  }
  const docsSnaps = await Promise.all(s);
  const ids = {} as DocumentRecord<string, number>;
  let i = 0;

  // return merged results
  return docsSnaps
    .map((q) => {
      // get relevant info from docs
      return q.docs.map((doc) => {
        const { _term } = doc.data() as { _term?: DocumentRecord<string, number> };
        const id = doc.id;
        const relevance = _term?.[exp] as number;
        return { id, relevance } as SearchResult;
      });
    })
    .flat()
    .filter((r) => {
      const { id, relevance } = r;
      ids[id] = relevance + (ids[id] ?? 0);
      return r;
    })
    .map((r) => {
      // merge relevances
      const value = ids[r.id];
      if (value !== undefined) {
        r.relevance = value;
      }
      return r;
      return r;
      // sort by relevance again
    })
    .sort((a, b) => (b.relevance < a.relevance ? -1 : a.relevance ? 1 : 0))
    .filter((r) => {
      // limit limit
      if (i < (limit ?? Number.MAX_SAFE_INTEGER)) {
        ++i;
        return r;
      }
      return;
    });
}
/**
 * Trigram Search callable function
 * @param _opts {
 *   query - query to search
 *   collectionToSearch - collection to search
 *   fieldsToSearch - fields to search
 *   searchCollectionName - name of search collection, default _search
 *   termField - name of term field to search, default _term
 *   limit - number of search results to limit, default 10
 * }
 * @retuns - will return a sorted array of docs with {id, relevance}
 *   the higher the relevance, the better match it is...
 */
export async function trigramSearch({
  query,
  collectionToSearch,
  fieldsToSearch = [_MERGED],
  searchCollectionName = _SEARCH,
  termField = _TERM,
  limit = 10,
}: TrigramSearchOptions): Promise<SearchResult[]> {
  // trigram function
  function tg(s1: string) {
    const n = 3;
    const r: string[] = [];
    for (let k = 0; k <= s1.length - n; k++) r.push(s1.substring(k, k + n));
    return r;
  }

  const trigrams = tg(query);
  const s = [];
  const searchable = [];

  // create searchable queries
  searchable.push({ s: trigrams, r: 3 });

  for (const a of trigrams) {
    const tg2 = trigrams.filter((t) => t !== a);
    searchable.push({ s: tg2, r: 2 });
    for (const b of tg2) {
      const tg3 = tg2.filter((t) => t !== b);
      searchable.push({ s: tg3, r: 1 });
    }
  }

  // go through each field
  for (const field of fieldsToSearch) {
    // go through all searchable queries
    for (const gram of searchable) {
      const query = db.collection(`${searchCollectionName}/${collectionToSearch}/${field}`) as CollectionReference<{
        relevance: number;
      }>;
      let newRef = query;
      for (const t of gram.s) {
        newRef = newRef.where(`${termField}.${t}`, '==', true) as CollectionReference<{ relevance: number }>;
      }
      // push to new query
      s.push(
        newRef.get().then((r: QuerySnapshot) => {
          return { ...r, relevance: gram.r };
        }),
      );
    }
  }

  const docsSnaps = await Promise.all(s);
  const ids = {} as DocumentRecord<string, number>;
  let i = 0;

  // return merged results
  return docsSnaps
    .map((q) => {
      // get relevant info from docs
      return q.docs.map((doc) => {
        const id = doc.id;
        const data = doc.data();
        const relevance = q.relevance;
        return { id, relevance, ...data };
      });
    })
    .flat()
    .filter((r) => {
      const { id, relevance } = r;
      // filter duplicates
      ids[id] = relevance + (ids[id] ?? 0);
      return r;
    })
    .map((r) => {
      // merge relevances
      const value = ids[r.id];
      if (value !== undefined) {
        r.relevance = value;
      }
      return r;
      // sort by relevance again
    })
    .sort((a, b) => (b.relevance < a.relevance ? -1 : a.relevance ? 1 : 0))
    .filter((r) => {
      // limit limit
      if (i < limit ?? Number.MAX_SAFE_INTEGER) {
        ++i;
        return r;
      }
      return;
    });
}
/**
 * indexes a collection by relevance
 * @param collectionToIndex
 * @param docId
 * @param _opts: {
 *   fieldsToIndex - array of fields to index
 *   rootCollectionPath - root path to keep users separate
 *   searchCollectionName - name of search collection, default _search
 *   numWords - number of words to index at a time, default 6
 *   mergeFields - whether or not to combine fields in one collection, default true
 *   mergedCollection - name of combined fields collection, default _all
 *   termField - name of terms array, default _term
 *   filterFunc - function to filter, can pass a soundex function
 * }
 */
export async function initRelevantIndex(
  collectionToIndex: string,
  docId: string,
  {
    fieldsToIndex,
    rootCollectionPath = '',
    searchCollectionName = _SEARCH,
    numWords = 6,
    mergeFields = true,
    mergedCollectionName = _MERGED,
    termField = _TERM,
    filterFunc,
  }: RelevantIndexOptions,
) {
  // Document to store data about the collection we want to index for searching
  const collectionToIndexDocument = db.doc(`${rootCollectionPath}/${searchCollectionName}/${collectionToIndex}`);

  // create or update
  const data = {} as DocumentRecord<string, string | DocumentRecord<string, number>>;
  let m = {} as DocumentRecord<string, number>;

  const docData = (await db.doc(`${rootCollectionPath}/${collectionToIndex}/${docId}`).get()).data();

  // go through each field to index
  for (const field of fieldsToIndex) {
    // new indexes
    let fieldValue = docData?.[field] as string | string[];

    // if array, turn into string
    if (Array.isArray(fieldValue)) {
      fieldValue = fieldValue.join(' ');
    }

    if (fieldValue === null || fieldValue === undefined || fieldValue.length === 0) {
      return;
    }

    let index = createIndex(fieldValue, numWords);

    // if filter function, run function on each word
    if (filterFunc) {
      const temp = [];
      for (const i of index) {
        temp.push(
          i
            .split(' ')
            .map((v: string) => filterFunc(v))
            .join(' '),
        );
      }
      index = temp;
      for (const phrase of index) {
        if (phrase) {
          let v = '';
          const t = phrase.split(' ');
          while (t.length > 0) {
            const r = t.shift() ?? '';
            v += v ? ' ' + r : r;
            // increment for relevance
            m[v] = m[v] ?? 0 + 1;
          }
        }
      }
    } else {
      for (const phrase of index) {
        if (phrase) {
          let v = '';
          for (let i = 0; i < phrase.length; i++) {
            v = phrase.slice(0, i + 1);
            // increment for relevance
            m[v] = m[v] ?? 0 + 1;
          }
        }
      }
    }

    // index individual field
    if (!mergeFields) {
      data[termField] = m;
      console.log('Creating relevant index on ', field, ' field for ', collectionToIndex + '/' + docId);
      const searchRefF = collectionToIndexDocument.collection(field).doc(docId);
      await searchRefF.set(data).catch((e) => {
        console.log(e);
      });
      // clear index history
      m = {};
    }
  }
  if (mergeFields) {
    data[termField] = m;
    console.log('Saving new relevant index for ', collectionToIndex + '/' + docId);
    const searchRef = collectionToIndexDocument.collection(mergedCollectionName).doc(docId);
    await searchRef.set(data).catch((e) => {
      console.log(e);
    });
  }

  return null;
}
/**
 * indexes a collection by relevance
 * @param change
 * @param context
 * @param _opts: {
 *   fieldsToIndex - array of fields to index
 *   rootCollectionPath - root path to keep users separate
 *   searchCollectionName - name of search collection, default _search
 *   numWords - number of words to index at a time, default 6
 *   mergeFields - whether or not to combine fields in one collection, default true
 *   mergedCollectionName - name of combined fields collection, default _all
 *   termField - name of terms array, default _term
 *   filterFunc - function to filter, can pass a soundex function
 * }
 * @param contextParamsKey - default is docId, but should match cloud function
 */
export async function relevantIndex(
  change: functions.Change<DocumentSnapshot<DocumentRecord<string, string>>>,
  context: functions.EventContext,
  {
    fieldsToIndex,
    rootCollectionPath = '',
    searchCollectionName = _SEARCH,
    numWords = 6,
    mergeFields = true,
    mergedCollectionName = _MERGED,
    termField = _TERM,
    filterFunc,
  }: RelevantIndexOptions,
  contextParamsKey = 'docId',
) {
  // don't run if repeated function
  if (await eventExists(context)) {
    return null;
  }

  const {
    params: { [contextParamsKey]: docId },
  } = context;
  // get collection
  const collectionToIndex = extractCollectionNameFromPath(context, rootCollectionPath);

  if (typeof collectionToIndex !== 'string' || collectionToIndex.length < 1) {
    throw new Error('Missing collection Id');
  }

  if (typeof docId !== 'string' || docId.length < 1) {
    throw new Error('Missing doc Id');
  }

  const collectionToIndexDocument = db.doc(`${rootCollectionPath}/${searchCollectionName}/${collectionToIndex}`);
  const searchRef = collectionToIndexDocument.collection(mergedCollectionName).doc(docId);

  // delete
  if (deleteDoc(change)) {
    if (mergeFields) {
      await searchRef.delete();
    } else {
      for (const field of fieldsToIndex) {
        const searchRefF = collectionToIndexDocument.collection(field).doc(docId);
        await searchRefF.delete();
      }
    }
  }
  // create or update
  if (writeDoc(change)) {
    const data = {} as DocumentRecord<string, string | DocumentRecord<string, number>>;
    let m = {} as DocumentRecord<string, number>;

    // go through each field to index
    for (const field of fieldsToIndex) {
      // new indexes
      let fieldValue = getAfter(change, field);

      // if array, turn into string
      if (Array.isArray(fieldValue)) {
        fieldValue = fieldValue.join(' ');
      }

      if (fieldValue === null || fieldValue === undefined || fieldValue.length === 0) {
        return;
      }

      let index = createIndex(fieldValue, numWords);

      // if filter function, run function on each word
      if (filterFunc) {
        const temp = [];
        for (const i of index) {
          temp.push(
            i
              .split(' ')
              .map((v: string) => filterFunc(v))
              .join(' '),
          );
        }
        index = temp;
        for (const phrase of index) {
          if (phrase) {
            let v = '';
            const t = phrase.split(' ');
            while (t.length > 0) {
              const r = t.shift() ?? '';
              v += v ? ' ' + r : r;
              // increment for relevance
              m[v] = m[v] ?? 0 + 1;
            }
          }
        }
      } else {
        for (const phrase of index) {
          if (phrase) {
            let v = '';
            for (let i = 0; i < phrase.length; i++) {
              v = phrase.slice(0, i + 1);
              // increment for relevance
              m[v] = m[v] ?? 0 + 1;
            }
          }
        }
      }

      // index individual field
      if (!mergeFields) {
        data[termField] = m;
        console.log('Creating relevant index on ', field, ' field for ', collectionToIndex + '/' + docId);
        const searchRefF = collectionToIndexDocument.collection(field).doc(docId);
        await searchRefF.set(data).catch((e) => {
          console.log(e);
        });
        // clear index history
        m = {};
      }
    }
    if (mergeFields) {
      data[termField] = m;
      console.log('Saving new relevant index for ', collectionToIndex + '/' + docId);
      await searchRef.set(data).catch((e) => {
        console.log(e);
      });
    }
  }
  return null;
}
/**
 * Generates an index for trigrams on a document
 * @param change
 * @param context
 * @param _opts {
 *   rootCollectionPath - root path to find collection to separate users
 *   fieldsToIndex - array of fields to index
 *   trigramCollectionName - name of trigram colleciton, default _trigrams
 *   mergeFields - whether or not to combine fields in one collection, default true
 *   mergedCollectionName - name of combined collection, default _all
 *   termField - name of field to store trigrams, default _term
 * }
 */
export async function trigramIndex(
  change: functions.Change<DocumentSnapshot<DocumentRecord<string, string>>>,
  context: functions.EventContext,
  {
    rootCollectionPath = '',
    trigramCollectionName = _TRIGRAMS,
    mergedCollectionName = _MERGED,
    mergeFields = true,
    termField = _TERM,
    fieldsToIndex,
  }: TrigramIndexOptions,
  contextParamsKey = 'docId',
) {
  // don't run if repeated function
  if (await eventExists(context)) {
    return null;
  }

  const {
    params: { [contextParamsKey]: docId },
  } = context;
  // get collection
  const collectionToIndex = extractCollectionNameFromPath(context, rootCollectionPath);

  if (typeof collectionToIndex !== 'string' || collectionToIndex.length < 1) {
    throw new Error('Missing collection Id');
  }

  if (typeof docId !== 'string' || docId.length < 1) {
    throw new Error('Missing doc Id');
  }

  const collectionToIndexDocument = db.doc(`${rootCollectionPath}/${trigramCollectionName}/${collectionToIndex}`);
  const trigramRef = collectionToIndexDocument.collection(mergedCollectionName).doc(docId);

  // delete
  if (deleteDoc(change)) {
    if (mergeFields) {
      await trigramRef.delete();
    } else {
      for (const field of fieldsToIndex) {
        const trigramRefF = collectionToIndexDocument.collection(field).doc(docId);
        await trigramRefF.delete();
      }
    }
  }
  // create or update
  if (writeDoc(change)) {
    let data = {} as DocumentRecord<string, string | DocumentRecord<string, boolean>>;
    let m = {} as DocumentRecord<string, boolean>;

    // go through each field to index
    for (const field of fieldsToIndex) {
      // new indexes
      let fieldValue = getAfter(change, field);

      // if array, turn into string
      if (Array.isArray(fieldValue)) {
        fieldValue = fieldValue.join(' ');
      }
      if (fieldValue === null || fieldValue === undefined) {
        return;
      }
      // generate trigrams
      const index = createIndex(fieldValue, 0).join(' ');
      const tg = generateTrigrams(index);
      for (const gram of tg) {
        m[gram] = true;
      }
      // save data to doc
      data[`_${field}`] = index;

      // index individual field
      if (!mergeFields) {
        data[termField] = m;
        console.log('Creating trigram index on ', field, ' field for ', collectionToIndex + '/' + docId);
        const searchRefF = collectionToIndexDocument.collection(field).doc(docId);
        await searchRefF.set(data).catch((e) => {
          console.log(e);
        });
        // clear index history
        m = {};
        data = {};
      }
    }
    if (mergeFields) {
      data[termField] = m;
      console.log('Saving new trigram index for ', collectionToIndex + '/' + docId);
      await trigramRef.set(data).catch((e) => {
        console.log(e);
      });
    }
  }
  return null;
}
/**
 * Returns a search array ready to be indexed
 * @param html - to be parsed for indexing
 * @param n - number of words to index
 * @returns - array of indexes
 */
function createIndex(html: string, n: number) {
  // get rid of pre code blocks
  function beforeReplace(text: string) {
    return text.replace(/&nbsp;/g, ' ').replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, '');
  }
  // create document after text stripped from html
  function createDocs(text: string) {
    const finalArray: string[] = [];
    const wordArray = text
      .toLowerCase()
      // fix only english problem, get unicode for any language
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/ +/g, ' ')
      .split(' ');
    do {
      finalArray.push(wordArray.slice(0, n).join(' '));
      wordArray.shift();
    } while (wordArray.length !== 0);
    return finalArray;
  }
  // strip text from html
  // get rid of code first
  return createDocs(htmlToText(beforeReplace(html), { ignoreHref: true, ignoreImage: true }));
}
