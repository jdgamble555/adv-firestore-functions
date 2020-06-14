/**
 * These functions do not do anything and are for future development only!!!
 * You can basically ignore this file.
 */

import * as admin from 'firebase-admin';

let serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

interface bTreeNode {
  values: string[];
  parent: string;
  left?: string;
  right?: string;
  size?: number;
}

class bTree {
  db: FirebaseFirestore.Firestore;
  collection: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
  order: number;

  constructor(order = 3) {
    this.db = admin.firestore();
    this.collection = this.db.collection('test');
    this.order = order;
  }

  async treeInsert(id: string, query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData>) {
    try {
      // set search database
      const searchDB = 'posts';

      // get root
      let currentNode = await this.collection.where('parent', '==', null).limit(1).get();

      // if no root
      if (currentNode.empty) {
        // insert at root
        const rootNode = { values: [id], size: 1, parent: null, left: null, right: null };
        this.collection.add(rootNode);
        return;
      }
      // find before node
      const beforeId = await this.getBeforeId(searchDB, id, query);
      const beforeNode = this.getBeforeNode(beforeId);
      const data = (await beforeNode).data();
      if (data.values.length < this.order) {
        // add node
      }

      // add actual leaf
      const leaf = { left: beforeId, size: 1 };
      this.collection.doc(id).set(leaf, { merge: true });

      // update parent leaf
    } catch (e) {
      console.log(e);
    }
  }

  private async getBeforeNode(beforeId: string) {
    const docRef = await this.collection.where('values', 'array-contains', beforeId).limit(1).get();
    return docRef.docs[0];
  }

  private async getBeforeId(
    collection: string,
    id: string,
    query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData>,
  ) {
    const docRef = this.db.collection(collection).doc(id);
    const beforeDoc = await query.endBefore(docRef).limit(1).get();
    return beforeDoc.docs[0].id;
  }

  async search(id?: string) {
    // get root node
    try {
      const rootQ = await this.collection.where('parent', '==', 'root').get();
      if (rootQ.size > 0) {
        const root = rootQ.docs[0].id;
        console.log(root);
      }
    } catch (e) {
      console.log(e);
    }
    //for (let v of values) {
  }
}

main();

async function main() {
  /*const t = new bTree();

  const q = admin.firestore().collection('posts').orderBy('title', 'asc');

  await t.treeInsert('blue', q);*/

  let me = 'yousus';
  me = me.replace(/\//g, 't');
  console.log(me);
}
