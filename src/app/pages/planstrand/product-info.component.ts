import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { getAppVersionStr } from '../../util/get-app-version-str';
import { versions } from '../../../environments/versions';
import { planstrandBuildRevision } from '../../util/planstrand-product-version';

@Component({
  selector: 'planstrand-product-info',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <main class="planstrand-page">
      <header class="planstrand-page-header">
        <h1>{{ isHelp ? 'Help' : 'About Planstrand' }}</h1>
      </header>
      <section class="folder-section">
        @if (isHelp) {
          <h2>Plan your day, one task at a time</h2>
          <p>
            Capture a task in Inbox, organize it in a Folder, then plan it for This Week
            or a specific day.
          </p>
          <p>
            Drag a task into My Day to reserve a WorkSession. Move or resize it in
            Calendar. Completing a WorkSession leaves its task independent.
          </p>
          <p>
            <a routerLink="/master-tasks">Tasks</a> ·
            <a routerLink="/this-week">This Week</a> ·
            <a routerLink="/schedule">Calendar</a> ·
            <a routerLink="/config">Settings and Sync &amp; Backup</a>
          </p>
          <p>
            <a
              href="https://github.com/hychaw/planstrand/issues"
              target="_blank"
              rel="noopener"
              >Report a problem</a
            >
          </p>
        } @else {
          <h2>Planstrand</h2>
          <p>Version {{ version }}</p>
          @if (buildRevision) {
            <p>Build {{ buildRevision }}</p>
          }
          <p>Local-first tasks, Folders, Planning, WorkSessions and Events.</p>
          <p>Copyright (c) 2026 How Yee Chaw. Original Planstrand contributions.</p>
          <p>
            <a
              href="https://github.com/hychaw/planstrand"
              target="_blank"
              rel="noopener"
              >Project repository</a
            >
            · <a routerLink="/help">Help</a>
          </p>
          <details>
            <summary>Open-source acknowledgements / Licenses</summary>
            <p>
              Planstrand is derived from
              <a
                href="https://github.com/super-productivity/super-productivity"
                target="_blank"
                rel="noopener"
                >Super Productivity</a
              >, created by Johannes Millan and its contributors, under the MIT License.
            </p>
            <p>
              <a
                href="assets/planstrand-license/LICENSE"
                target="_blank"
                >Planstrand MIT License</a
              >
              ·
              <a
                href="assets/upstream-license.txt"
                target="_blank"
                >Upstream copyright and MIT License</a
              >
              ·
              <a
                href="3rdpartylicenses.txt"
                target="_blank"
                >Dependency licenses</a
              >
            </p>
          </details>
        }
      </section>
    </main>
  `,
  styleUrl: './planstrand-page.component.scss',
})
export class ProductInfoComponent {
  readonly isHelp = inject(ActivatedRoute).snapshot.data['productInfo'] === 'help';
  readonly version = getAppVersionStr();
  readonly buildRevision = planstrandBuildRevision(versions.revision);
}
