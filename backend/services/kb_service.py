import chromadb
from chromadb.utils import embedding_functions
import os

class KBService:
    def __init__(self, persist_directory="./chroma_db"):
        self.persist_directory = persist_directory
        self.client = chromadb.PersistentClient(path=self.persist_directory)
        self.emb_fn = embedding_functions.DefaultEmbeddingFunction()
        self.collection = self.client.get_or_create_collection(
            name="meeting_notes", 
            embedding_function=self.emb_fn
        )

    def add_knowledge(self, text: str, metadata: dict = None):
        try:
            self.collection.add(
                documents=[text],
                metadatas=[metadata or {}],
                ids=[f"doc_{self.collection.count() + 1}"]
            )
            return True
        except Exception as e:
            print(f"Error adding to ChromaDB: {e}")
            return False

    def add_qa_pair(self, question: str, answer: str):
        try:
            self.collection.add(
                documents=[question],
                metadatas=[{"answer": answer}],
                ids=[f"qa_{self.collection.count() + 1}"]
            )
            return True
        except Exception as e:
            print(f"Error saving QA pair: {e}")
            return False

    def find_cached_answer(self, query: str, threshold: float = 0.2):
        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=1
            )
            if results["distances"] and results["distances"][0][0] < threshold:
                return results["metadatas"][0][0]["answer"]
            return None
        except Exception as e:
            print(f"Error checking cache: {e}")
            return None

    def query_knowledge(self, query: str, n_results: int = 3):
        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=n_results
            )
            return results["documents"][0] if results["documents"] else []
        except Exception as e:
            print(f"Error querying ChromaDB: {e}")
            return []

kb_service = KBService()
