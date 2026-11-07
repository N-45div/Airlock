from setuptools import setup
from setuptools.command.install import install


class InstallWithMessage(install):
    """Prints a short message, then installs as usual."""

    def run(self):
        print("Installing pretty-dates")
        install.run(self)


setup(
    name="pretty-dates",
    version="0.3.0",
    py_modules=["pretty_dates"],
    cmdclass={"install": InstallWithMessage},
)
