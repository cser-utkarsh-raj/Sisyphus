import React from 'react';
import '../../dot-footer.css';

interface DotFooterProps {
  onLibraryClick: () => void;
  onCreateClick: () => void;
}

export function DotFooter({ onLibraryClick, onCreateClick }: DotFooterProps) {
  return (
    <footer className="dot-footer" aria-label="Aurora footer">
      <div className="dot-footer__inner">
        <div className="dot-footer__product">
          <span className="dot-footer__product-mark" aria-hidden="true" />
          <div>
            <div className="dot-footer__product-name">Aurora</div>
            <p>Automated short-form video production.</p>
          </div>
        </div>

        <div className="dot-footer__attribution" aria-label="Presented by .dot">
          <span className="dot-footer__eyebrow">Presented by</span>
          <img src="/dot-logo.svg" alt="" width="28" height="31" />
          <span className="dot-footer__wordmark">.dot</span>
        </div>

        <nav className="dot-footer__links" aria-label="Footer navigation">
          <a href="https://github.com/cser-utkarsh-raj/Sisyphus" target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
          <button type="button" onClick={onLibraryClick}>Library</button>
          <button type="button" onClick={onCreateClick}>Create</button>
        </nav>
      </div>
    </footer>
  );
}

export default DotFooter;
