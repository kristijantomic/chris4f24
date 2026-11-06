import { type SubmitEvent, useEffect, useRef, useState } from 'react';
import type { FsNode, NodeType } from './types';

const API_BASE_URL = 'http://localhost:3001/api/filesystem';
const SUGGESTIONS_DEBOUNCE_MS = 350;

export default function App() {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FsNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [createType, setCreateType] = useState<NodeType>('folder');
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const [searchText, setSearchText] = useState('');
  const [suggestionPrefix, setSuggestionPrefix] = useState('');
  const [suggestions, setSuggestions] = useState<FsNode[]>([]);
  const [searchName, setSearchName] = useState<string | null>(null);
  const [searchAllFolders, setSearchAllFolders] = useState(false);
  const [searchResults, setSearchResults] = useState<FsNode[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadFolderContent() {
      const url = new URL(API_BASE_URL);

      if (folderId) url.searchParams.set('parentId', folderId);

      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);

        const page: { items: FsNode[] } = await response.json();

        setNodes(page.items);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setNodes([]);
        setError(err instanceof Error ? err.message : 'Failed to load folder');
      }
    }

    void loadFolderContent();

    return () => controller.abort();
  }, [folderId, reloadCount]);

  useEffect(() => {
    if (!suggestionPrefix) return;

    const controller = new AbortController();

    async function loadSuggestions() {
      const url = new URL(`${API_BASE_URL}/search/suggestions`);

      url.searchParams.set('prefix', suggestionPrefix);

      if (!searchAllFolders) url.searchParams.set('parentId', folderId ?? 'root');

      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);

        const page: { items: FsNode[] } = await response.json();
        setSuggestions(page.items);
      } catch {
        if (!controller.signal.aborted) setSuggestions([]);
      }
    }

    const timer = setTimeout(() => void loadSuggestions(), SUGGESTIONS_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [suggestionPrefix, searchAllFolders, folderId]);

  useEffect(() => {
    if (searchName === null) return;

    const name = searchName;
    const controller = new AbortController();

    async function searchFiles() {
      const url = new URL(`${API_BASE_URL}/search`);

      url.searchParams.set('name', name);

      if (!searchAllFolders) url.searchParams.set('parentId', folderId ?? 'root');

      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);

          throw new Error(payload?.error?.message ?? `Search failed with status ${response.status}`);
        }

        const page: { items: FsNode[] } = await response.json();
        setSearchResults(page.items);
        setSearchError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setSearchResults([]);
        setSearchError(err instanceof Error ? err.message : 'Search failed');
      }
    }

    void searchFiles();

    return () => controller.abort();
  }, [searchName, searchAllFolders, folderId, reloadCount]);

  function handleSearchTextChange(value: string) {
    setSearchText(value);
    setSuggestionPrefix(value);
    if (!value) setSearchName(null);
  }

  function submitSearch(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = searchText.trim();
    setSuggestionPrefix('');
    setSearchName(name || null);
  }

  function selectSuggestion(name: string) {
    setSearchText(name);
    setSuggestionPrefix('');
    setSearchName(name);
  }

  function parentLabel(file: FsNode) {
    return file.parentId === folderId ? ' (current dir)' : ` (parent dir ID: ${file.parentId ?? 'root'})`;
  }

  function openFolder(id: string | null) {
    setSuggestionPrefix('');
    setSuggestions([]);
    setFolderId(id);
  }

  function openFileFolder(parentId: string | null) {
    setSearchText('');
    setSearchName(null);
    openFolder(parentId);
  }

  function openCreateDialog(type: NodeType) {
    setCreateType(type);
    setNewName('');
    setCreateError(null);
    createDialogRef.current?.showModal();
  }

  async function createNode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const url = `${API_BASE_URL}/${createType === 'folder' ? 'folders' : 'files'}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, parentId: folderId }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);

        throw new Error(payload?.error?.message ?? `Create failed with status ${response.status}`);
      }

      createDialogRef.current?.close();
      setReloadCount((count) => count + 1);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : `Failed to create ${createType}`);
    }
  }

  async function deleteNode(node: FsNode) {
    const url = `${API_BASE_URL}/${node.type === 'folder' ? 'folders' : 'files'}/${node.id}`;

    try {
      const response = await fetch(url, { method: 'DELETE' });
      
      if (!response.ok) throw new Error(`Delete failed with status ${response.status}`);

      setNodes((current) => current.filter((item) => item.id !== node.id));
      setSearchResults((current) => current.filter((item) => item.id !== node.id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  return (
    <div>
      <div>
        <button onClick={() => openFolder(null)} style={{ marginRight: '10px' }}>Root</button>
        <button onClick={() => openCreateDialog('folder')} style={{ marginRight: '10px' }}>New folder</button>
        <button onClick={() => openCreateDialog('file')} style={{ marginRight: '10px' }}>New file</button>

        <hr />
        <form onSubmit={submitSearch}>
          <input type="text"
            placeholder="Search files by name"
            value={searchText}
            onChange={(e) => handleSearchTextChange(e.target.value)}
            style={{ marginRight: '10px' }}
          />
          <button type="submit" style={{ marginRight: '10px' }}>Search</button>
          <label>
            <input type="checkbox"
              checked={searchAllFolders}
              onChange={(e) => setSearchAllFolders(e.target.checked)}
            />
            All folders
          </label>
          {suggestionPrefix && suggestions.length > 0 && (
            <ul>
              {suggestions.map((file) => (
                <li key={file.id}>
                  <button type="button" onClick={() => selectSuggestion(file.name)}>{file.name}</button>
                  {parentLabel(file)}
                </li>
              ))}
            </ul>
          )}
        </form>
        {searchName !== null && (
          <div>
            <h2>Search results for "{searchName}"</h2>
            {searchError && <p>{searchError}</p>}
            {!searchError && searchResults.length === 0 && <p>No files found</p>}
            <ul>
              {searchResults.map((file) => (
                <li key={file.id}>
                  <button onClick={() => void deleteNode(file)} style={{ marginRight: '10px' }}>X</button>
                  {file.parentId !== folderId && (
                    <button onClick={() => openFileFolder(file.parentId)} style={{ marginRight: '10px' }}>Open folder</button>
                  )}
                  {file.name}{parentLabel(file)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div>
        <h1>Current dir ID: {folderId ?? 'root'}</h1>
      </div>
      <dialog ref={createDialogRef}>
        <form onSubmit={(event) => void createNode(event)}>
          <h2>New {createType}</h2>
          <input
            type="text"
            placeholder={`${createType === 'folder' ? 'Directory' : 'File'} name`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            autoFocus
          />
          {createError && <p>{createError}</p>}
          <button type="button" onClick={() => createDialogRef.current?.close()} style={{ marginRight: '10px' }}>Cancel</button>
          <button type="submit">Create</button>
        </form>
      </dialog>
      <div>
        {error && <p>{error}</p>}
        <ul>
          {nodes.map((node) => (
            <li key={node.id}>
              <button onClick={() => void deleteNode(node)} style={{marginRight: '10px'}}>X</button>
              {node.type === 'folder' ? (
                <button onClick={() => openFolder(node.id)} style={{ marginRight: '10px' }}>Open:{node.name}</button>
              ) : (
                node.name
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}