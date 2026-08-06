import {nanoid} from 'nanoid';
import {useEffect, useRef, useState} from 'react';
import {Button} from '../../components/button.tsx';
import {GigabugsPromo} from '../../components/gigabugs-promo.tsx';
import {
  ImageUploadArea,
  type TextAreaPatch,
} from '../../components/image-upload-area.tsx';
import {useIsOffline} from '../../hooks/use-is-offline.ts';
import {useLogin} from '../../hooks/use-login.tsx';
import {maxCommentLength} from '../../limits.ts';
import {isCtrlEnter} from './is-ctrl-enter.ts';
import {useZerobugsMutation} from '../../data/snapback.ts';

export function CommentComposer({
  id,
  body,
  issueID,
  onDone,
}: {
  issueID: string;
  id?: string | undefined;
  body?: string | undefined;
  onDone?: (() => void) | undefined;
}) {
  const addComment = useZerobugsMutation('comment.add');
  const editComment = useZerobugsMutation('comment.edit');
  const login = useLogin();
  const isOffline = useIsOffline();
  const [currentBody, setCurrentBody] = useState(body ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const save = async () => {
    setCurrentBody(body ?? '');
    if (!id) {
      await addComment({id: nanoid(), issueID, body: currentBody, created: Date.now()});
      onDone?.();
      return;
    }

    await editComment({id, body: currentBody});
    onDone?.();
  };

  // Handle textarea resizing
  function autoResizeTextarea(textarea: HTMLTextAreaElement) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  useEffect(() => {
    const textareas = document.querySelectorAll(
      '.autoResize',
    ) as NodeListOf<HTMLTextAreaElement>;

    const handleResize = (textarea: HTMLTextAreaElement) => {
      autoResizeTextarea(textarea);
      const handleInput = () => autoResizeTextarea(textarea);
      textarea.addEventListener('input', handleInput);

      return () => textarea.removeEventListener('input', handleInput);
    };

    const cleanupFns = Array.from(textareas, handleResize);

    return () => cleanupFns.forEach(fn => fn());
  }, [currentBody]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentBody(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isCtrlEnter(e)) {
      e.preventDefault();
      void save();
    }
  };

  const onInsert = (patch: TextAreaPatch) => {
    setCurrentBody(prev => patch.apply(prev));
  };

  if (!login.loginState) {
    return null;
  }

  return (
    <div className="comment-composer">
      <ImageUploadArea textAreaRef={textareaRef} onInsert={onInsert}>
        <textarea
          disabled={isOffline}
          value={currentBody}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className="comment-input autoResize"
          /* The launch post has a speical maxLength because trolls */
          maxLength={maxCommentLength(issueID)}
          ref={textareaRef}
        />
      </ImageUploadArea>
      <div className="comment-bottom-bar">
        <Button
          className="secondary-button"
          eventName={id ? 'Save comment edits' : 'Add new comment'}
          onAction={() => void save()}
          disabled={currentBody.trim().length === 0}
        >
          {id ? 'Save' : 'Add comment'}
        </Button>
        {id ? (
          <Button
            className="edit-comment-cancel"
            eventName="Cancel comment edits"
            onAction={onDone}
          >
            Cancel
          </Button>
        ) : null}
        <GigabugsPromo />
      </div>
    </div>
  );
}
