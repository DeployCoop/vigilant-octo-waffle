# Local Helm Charts

This is the default local Helm charts directory (`./charts`) for **Vigilant Octo Waffle**.

## Adding Your Own Charts
Any subdirectory placed in this folder containing a valid `Chart.yaml`, `values.yaml`, and `templates/` folder will automatically appear in:
1. The **Applications Catalog (`/apps`)** under the **"Custom & Local Charts"** category.
2. The **Helm Release Inspector & Local Charts Hub (`/helm`)** with automatic linting, values inspection, template preview, and 1-click deployment.
3. The **App Details (`/apps/<chart-name>`)** page for values customization and GitOps / Helm deployment.

## Changing This Directory
You can change this charts directory to any path on your system:
- Set `THIS_CHARTS_DIR="/path/to/charts"` in `.env` or `src/default.env`.
- Or navigate to **Helm Hub (`/helm`)** in the Web UI, type the directory path, and click **Apply Directory**.

For a full reference and examples, see [`example.charts/README.md`](../example.charts/README.md).
