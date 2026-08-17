declare function openSystemDialog(): void;

function FeedCard() {
  return null;
}

export function LegitimateChooser() {
  return (
    <section>
      <div data-testid="sm-trending-row">
        <FeedCard />
      </div>
      <input
        id="attachment-file"
        type="file"
      />
      <label
        htmlFor="attachment-file"
        onClick={openSystemDialog}
        data-testid="sm-convo-attach"
      >
        Attach media
      </label>
    </section>
  );
}
